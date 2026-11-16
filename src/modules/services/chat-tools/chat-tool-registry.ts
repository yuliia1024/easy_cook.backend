import { Logger } from '@nestjs/common';
import { jsonSchema, JSONSchema7, Tool, ToolSet } from 'ai';
import { z } from 'zod';
import {
  CHAT_TOOL_FAILED_MESSAGE,
  CHAT_TOOL_SERVICE_CALL_MESSAGE,
  ChatToolErrorCode,
  ChatToolName,
  ChatToolOperation,
} from '../../../common/constants';
import { AppError, NotFoundError } from '../../../common/exceptions';
import { ChatServiceCall, ChatToolError, ChatToolEvent } from '../../../common/types';

/** The tools that hand a request over to a backend service instead of returning data. */
type ServiceCallToolName = ChatServiceCall['name'];

interface ChatToolBase<I> {
  name: ChatToolName;
  /** Tells the model when to call the tool; part of what the model reads. */
  description: string;
  /** The arguments, parsed before the tool runs: invalid ones go back to the model as an error. */
  inputSchema: z.ZodType<I>;
}

/** Reads data through a service and returns it to the model, in the model's loop. */
export interface ReadChatTool<I> extends ChatToolBase<I> {
  operation: ChatToolOperation.Read;
  execute: (input: I, abortSignal?: AbortSignal) => Promise<object>;
}

/** What a write tool returns: the result the model reads and the event the client gets, if any. */
export interface ChatToolWriteResult {
  output: object;
  event: ChatToolEvent | null;
}

/**
 * Changes data through a service, in the model's loop: the model reads the result and tells the
 * user. Called at most once per reply (`ChatToolRun.writes`), so one message never writes twice,
 * and never after a service call: the backend has not run it yet, so the write would act on the
 * state before it.
 */
export interface WriteChatTool<I> extends ChatToolBase<I> {
  operation: ChatToolOperation.Write;
  /** Write tools it may not follow in one reply: it would act on what they did not save yet. */
  notAfter?: ChatToolName[];
  execute: (input: I, abortSignal?: AbortSignal) => Promise<ChatToolWriteResult>;
}

/**
 * Only records the call (`ChatToolRun.serviceCall`) and ends the loop: the backend runs it on the
 * same path as without tools, its checks and writes included.
 */
export interface ServiceCallChatTool<I> extends ChatToolBase<I> {
  name: ServiceCallToolName;
  operation: ChatToolOperation.ServiceCall;
}

// The input type is checked where a tool is defined (`readTool`, `serviceCallTool`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChatTool = ReadChatTool<any> | WriteChatTool<any> | ServiceCallChatTool<any>;

export const readTool = <I>(definition: Omit<ReadChatTool<I>, 'operation'>): ReadChatTool<I> => ({
  ...definition,
  operation: ChatToolOperation.Read,
});

export const writeTool = <I>(
  definition: Omit<WriteChatTool<I>, 'operation'>,
): WriteChatTool<I> => ({ ...definition, operation: ChatToolOperation.Write });

export const serviceCallTool = <I>(
  definition: Omit<ServiceCallChatTool<I>, 'operation'>,
): ServiceCallChatTool<I> => ({ ...definition, operation: ChatToolOperation.ServiceCall });

/**
 * A tool call of the model: the arguments as it sent them, what it got back (the result or the
 * `ChatToolError`), the error code, if any, and how long the tool ran.
 */
export interface ChatToolCall {
  name: string;
  input: unknown;
  output: object;
  error: ChatToolErrorCode | null;
  durationMs: number;
}

/** Hears the tool calls of a run as they happen: progress for the client, the trace. */
export interface ChatToolRunListener {
  /** Before the tool runs, invalid arguments included. */
  onToolStart?: (name: ChatToolName) => void;
  onToolEnd?: (call: ChatToolCall) => void;
  /** The event of a write tool, once it wrote; before `onToolEnd`. */
  onToolEvent?: (event: ChatToolEvent) => void;
}

/** The tool calls of one reply: the steps the model took and the service call that ended them. */
export class ChatToolRun {
  public serviceCall: ChatServiceCall | null = null;
  public readonly calls: ChatToolCall[] = [];
  /** The write tools called with valid arguments; a second call of one is rejected. */
  public readonly writes = new Set<ChatToolName>();

  constructor(public readonly listener: ChatToolRunListener = {}) {}

  /** A service call ends the loop: its result comes from the backend, not from the model. */
  public isDone(): boolean {
    return this.serviceCall !== null;
  }
}

/** `path: problem` for every argument that did not pass. */
const issuesOf = (error: z.ZodError): string[] =>
  error.issues.map(
    ({ path, message }) => `${path.length ? path.join('.') : '(arguments)'}: ${message}`,
  );

/**
 * What the model is told about a failed call. A domain error (`AppError`) keeps its message, which
 * is written for the client; anything else is logged and only reported as failed.
 */
export function toChatToolError(error: unknown, logger: Logger): ChatToolError {
  if (error instanceof z.ZodError) {
    return {
      error: ChatToolErrorCode.InvalidArguments,
      message: 'The arguments do not match the tool schema. Fix them and call the tool again.',
      issues: issuesOf(error),
    };
  }
  if (error instanceof NotFoundError) {
    return { error: ChatToolErrorCode.NotFound, message: error.message };
  }
  if (error instanceof AppError) {
    return { error: ChatToolErrorCode.Rejected, message: error.message };
  }
  logger.error('Chat tool failed', error instanceof Error ? error.stack : String(error));
  return { error: ChatToolErrorCode.Failed, message: CHAT_TOOL_FAILED_MESSAGE };
}

/**
 * One line per tool run: its call id (the one of the model's `called` line), time, and the size of
 * the result or the error code. Never the arguments or the result: they hold what the user wrote.
 */
function logToolCall(logger: Logger, call: ChatToolCall, toolCallId: string): void {
  const line = `Chat tool ${call.name} (${toolCallId})`;
  if (call.error) {
    logger.warn(`${line} returned ${call.error} in ${call.durationMs}ms`);
  } else {
    logger.log(`${line} ok in ${call.durationMs}ms, ${JSON.stringify(call.output).length} chars`);
  }
}

/** Why a write tool may not run now, or null: once per reply, not after a service call or `notAfter`. */
function writeRejection(chatTool: WriteChatTool<unknown>, run: ChatToolRun): string | null {
  if (run.writes.has(chatTool.name)) {
    return `${chatTool.name} was already called in this reply.`;
  }
  if (run.serviceCall) {
    return `${chatTool.name} cannot follow ${run.serviceCall.name} in one reply. Call it in the next one.`;
  }
  const earlier = chatTool.notAfter?.find((name) => run.writes.has(name));
  return earlier
    ? `${chatTool.name} cannot follow ${earlier} in one reply: wait for the user's answer.`
    : null;
}

/**
 * The tools for the AI SDK. The SDK gets the JSON schema only and passes the raw arguments on: the
 * registry parses them with the zod schema itself, so invalid arguments, an unknown recipe or a
 * failed service are a result the model reads (`ChatToolError`), never an exception of the reply.
 * An aborted reply rethrows. A second service call in one reply is rejected: one reply plans once;
 * so is a second call of a write tool, whatever the first one returned, and a write after a
 * service call or after a tool of its `notAfter`.
 */
export function toToolSet(tools: ChatTool[], run: ChatToolRun, logger: Logger): ToolSet {
  const call = async (
    chatTool: ChatTool,
    args: unknown,
    abortSignal: AbortSignal | undefined,
  ): Promise<object> => {
    const parsed = chatTool.inputSchema.safeParse(args);
    if (!parsed.success) {
      return toChatToolError(parsed.error, logger);
    }
    if (chatTool.operation === ChatToolOperation.ServiceCall) {
      if (run.serviceCall) {
        return {
          error: ChatToolErrorCode.Rejected,
          message: `${run.serviceCall.name} was already called in this reply.`,
        };
      }
      run.serviceCall = { name: chatTool.name, input: parsed.data } as ChatServiceCall;
      return { status: 'accepted', message: CHAT_TOOL_SERVICE_CALL_MESSAGE };
    }
    if (chatTool.operation === ChatToolOperation.Write) {
      const rejection = writeRejection(chatTool, run);
      if (rejection) {
        return { error: ChatToolErrorCode.Rejected, message: rejection };
      }
      run.writes.add(chatTool.name);
    }
    try {
      if (chatTool.operation === ChatToolOperation.Read) {
        return await chatTool.execute(parsed.data, abortSignal);
      }
      const { output, event } = await chatTool.execute(parsed.data, abortSignal);
      if (event) {
        run.listener.onToolEvent?.(event);
      }
      return output;
    } catch (error) {
      if (abortSignal?.aborted) {
        throw error;
      }
      return toChatToolError(error, logger);
    }
  };

  const names = tools.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error(`Chat tools must have unique names: ${names.join(', ')}`);
  }
  return Object.fromEntries(
    tools.map((chatTool): [string, Tool<unknown, object>] => [
      chatTool.name,
      {
        description: chatTool.description,
        inputSchema: jsonSchema<unknown>(
          z.toJSONSchema(chatTool.inputSchema, { target: 'draft-07', io: 'input' }) as JSONSchema7,
        ),
        execute: async (args: unknown, { abortSignal, toolCallId }): Promise<object> => {
          run.listener.onToolStart?.(chatTool.name);
          const startedAt = performance.now();
          const result = await call(chatTool, args, abortSignal);
          const error = 'error' in result ? (result as ChatToolError).error : null;
          const record: ChatToolCall = {
            name: chatTool.name,
            input: args,
            output: result,
            error,
            durationMs: Math.round(performance.now() - startedAt),
          };
          run.calls.push(record);
          run.listener.onToolEnd?.(record);
          logToolCall(logger, record, toolCallId);
          return result;
        },
      },
    ]),
  );
}
