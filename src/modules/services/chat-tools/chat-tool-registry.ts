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
import { ChatServiceCall, ChatToolError } from '../../../common/types';

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
export type ChatTool = ReadChatTool<any> | ServiceCallChatTool<any>;

export const readTool = <I>(definition: Omit<ReadChatTool<I>, 'operation'>): ReadChatTool<I> => ({
  ...definition,
  operation: ChatToolOperation.Read,
});

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
}

/** The tool calls of one reply: the steps the model took and the service call that ended them. */
export class ChatToolRun {
  public serviceCall: ChatServiceCall | null = null;
  public readonly calls: ChatToolCall[] = [];

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
 * The tools for the AI SDK. The SDK gets the JSON schema only and passes the raw arguments on: the
 * registry parses them with the zod schema itself, so invalid arguments, an unknown recipe or a
 * failed service are a result the model reads (`ChatToolError`), never an exception of the reply.
 * An aborted reply rethrows. A second service call in one reply is rejected: one reply plans once.
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
    try {
      return await chatTool.execute(parsed.data, abortSignal);
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
        execute: async (args: unknown, { abortSignal }): Promise<object> => {
          run.listener.onToolStart?.(chatTool.name);
          const startedAt = Date.now();
          const result = await call(chatTool, args, abortSignal);
          const error = 'error' in result ? (result as ChatToolError).error : null;
          const record: ChatToolCall = {
            name: chatTool.name,
            input: args,
            output: result,
            error,
            durationMs: Date.now() - startedAt,
          };
          run.calls.push(record);
          run.listener.onToolEnd?.(record);
          if (error) {
            logger.warn(`Chat tool ${chatTool.name} returned ${error}`);
          }
          return result;
        },
      },
    ]),
  );
}
