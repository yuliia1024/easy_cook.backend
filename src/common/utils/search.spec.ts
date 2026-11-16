import { searchWords } from './search';

describe('searchWords', () => {
  it('splits on spaces and commas and lower-cases', () => {
    expect(searchWords(' Boiled  white,rice ')).toEqual(['boiled', 'white', 'rice']);
  });

  it('is empty for no search', () => {
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords(' , ')).toEqual([]);
  });
});
