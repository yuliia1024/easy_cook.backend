import { MessageRole, PreferenceChangeAction, PreferenceType } from '../../../common/constants';
import { pendingPreferenceChange } from './pending-preference-change';

describe('pendingPreferenceChange', () => {
  const change = {
    action: PreferenceChangeAction.Add,
    preferenceType: PreferenceType.Allergy,
    value: 'peanut',
  };
  const user = { role: MessageRole.User, preferenceChange: null };
  const reply = (preferenceChange: unknown = null) => ({
    role: MessageRole.Assistant,
    preferenceChange: preferenceChange as never,
  });

  it('is the change the latest reply proposed, also after the next user message', () => {
    expect(pendingPreferenceChange([user, reply(change)])).toEqual(change);
    expect(pendingPreferenceChange([user, reply(change), user])).toEqual(change);
  });

  it('is null once a later reply proposed nothing', () => {
    expect(pendingPreferenceChange([user, reply(change), user, reply()])).toBeNull();
  });

  it('is null without a reply or for a stored value that does not match the schema', () => {
    expect(pendingPreferenceChange([])).toBeNull();
    expect(pendingPreferenceChange([user])).toBeNull();
    expect(pendingPreferenceChange([reply({ ...change, action: 'replace' })])).toBeNull();
  });
});
