import { FilenameCondition } from './FilenameCondition';
import { KeywordCondition } from './KeywordCondition';
import { QueryBuilder } from './QueryBuilder';
import { QueryExecutor } from './QueryExecutor';
import { SearchContext } from './SearchContext';

describe('QueryExecutor', () => {
  it('should inject context to all conditions', async () => {
    // Create mock conditions with spy on evaluate method
    const filenameCondition = new FilenameCondition(['cat']);
    const keywordCondition = new KeywordCondition(['black cat']);

    // Mock the evaluate methods to return empty results
    const filenameEvaluateSpy = jest
      .spyOn(filenameCondition, 'evaluate')
      .mockResolvedValue(new Map());
    const keywordEvaluateSpy = jest
      .spyOn(keywordCondition, 'evaluate')
      .mockResolvedValue(new Map());

    const queryBuilder = new QueryBuilder();
    queryBuilder.and(filenameCondition);
    queryBuilder.and(keywordCondition);
    const condition = queryBuilder.build();

    const searchContext = {
      documentStore: {},
    } as SearchContext;

    const queryExecutor = new QueryExecutor(searchContext);

    await queryExecutor.execute(condition);

    expect(filenameEvaluateSpy).toHaveBeenCalled();
    expect(keywordEvaluateSpy).toHaveBeenCalled();
    expect(condition).toMatchSnapshot();
  });

  it('should return intersected results when using AND condition', async () => {
    const filenameCondition = new FilenameCondition(['cat']);
    const keywordCondition = new KeywordCondition(['black cat']);

    // Mock the evaluate methods to return specific results
    const filenameResults = new Map();
    filenameResults.set(1, { document: { id: 1, name: 'cat.md' }, score: 0.8 });
    filenameResults.set(2, { document: { id: 2, name: 'cat_photo.md' }, score: 0.7 });
    filenameResults.set(3, { document: { id: 3, name: 'another_cat.md' }, score: 0.6 });

    const keywordResults = new Map();
    keywordResults.set(1, { document: { id: 1, name: 'cat.md' }, score: 0.9 });
    keywordResults.set(3, { document: { id: 3, name: 'another_cat.md' }, score: 0.5 });
    keywordResults.set(4, { document: { id: 4, name: 'black_kitten.md' }, score: 0.4 });

    jest.spyOn(filenameCondition, 'evaluate').mockResolvedValue(filenameResults);
    jest.spyOn(keywordCondition, 'evaluate').mockResolvedValue(keywordResults);

    const queryBuilder = new QueryBuilder();
    queryBuilder.and(filenameCondition).and(keywordCondition);
    const condition = queryBuilder.build();

    const searchContext = {} as SearchContext;

    const queryExecutor = new QueryExecutor(searchContext);
    const result = await queryExecutor.execute(condition);

    expect(result).toMatchObject({
      conditionResults: [
        {
          document: {
            id: 1,
            name: 'cat.md',
          },
          keywordsMatched: [],
          score: 1.7000000000000002,
        },
        {
          document: {
            id: 3,
            name: 'another_cat.md',
          },
          keywordsMatched: [],
          score: 1.1,
        },
      ],
      count: 2,
    });
  });

  it('should return unioned results when using OR condition', async () => {
    const filenameCondition = new FilenameCondition(['cat']);
    const keywordCondition = new KeywordCondition(['black cat']);

    // Mock the evaluate methods to return specific results
    const filenameResults = new Map();
    filenameResults.set(1, { document: { id: 1, name: 'cat.md' }, score: 0.8 });
    filenameResults.set(2, { document: { id: 2, name: 'cat_photo.md' }, score: 0.7 });
    filenameResults.set(3, { document: { id: 3, name: 'another_cat.md' }, score: 0.6 });

    const keywordResults = new Map();
    keywordResults.set(1, { document: { id: 1, name: 'cat.md' }, score: 0.9 });
    keywordResults.set(3, { document: { id: 3, name: 'another_cat.md' }, score: 0.5 });
    keywordResults.set(4, { document: { id: 4, name: 'black_kitten.md' }, score: 0.4 });

    jest.spyOn(filenameCondition, 'evaluate').mockResolvedValue(filenameResults);
    jest.spyOn(keywordCondition, 'evaluate').mockResolvedValue(keywordResults);

    const queryBuilder = new QueryBuilder();
    queryBuilder.or(filenameCondition).or(keywordCondition);
    const condition = queryBuilder.build();

    const searchContext = {} as SearchContext;

    const queryExecutor = new QueryExecutor(searchContext);
    const result = await queryExecutor.execute(condition);

    expect(result).toMatchObject({
      conditionResults: [
        {
          document: {
            id: 1,
            name: 'cat.md',
          },
          score: 1.7000000000000002,
        },
        {
          document: {
            id: 3,
            name: 'another_cat.md',
          },
          score: 1.1,
        },
        {
          document: {
            id: 2,
            name: 'cat_photo.md',
          },
          score: 0.7,
        },
        {
          document: {
            id: 4,
            name: 'black_kitten.md',
          },
          score: 0.4,
        },
      ],
      count: 4,
    });
  });
});
