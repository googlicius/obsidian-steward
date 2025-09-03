import { AndCondition } from './AndCondition';
import { FilenameCondition } from './FilenameCondition';
import { KeywordCondition } from './KeywordCondition';
import { QueryBuilder } from './QueryBuilder';

describe('QueryBuilder', () => {
  it('should build an AND condition', () => {
    const queryBuilder = new QueryBuilder();
    queryBuilder.and(new FilenameCondition(['cat']));
    queryBuilder.and(new KeywordCondition(['black cat']));
    const condition = queryBuilder.build();
    expect(condition).toMatchSnapshot();
  });

  it('should build an OR condition', () => {
    // const orConditions: Condition[] = [];
    const queryBuilder = new QueryBuilder();

    queryBuilder.or(new FilenameCondition(['cat']));
    queryBuilder.or(new KeywordCondition(['black cat']));

    const condition = queryBuilder.build();

    expect(condition).toMatchSnapshot();
  });

  it('should build nested conditions', () => {
    const queryBuilder = new QueryBuilder();
    queryBuilder.or(
      new AndCondition(new FilenameCondition(['cat']), new KeywordCondition(['black cat']))
    );
    queryBuilder.or(
      new AndCondition(new FilenameCondition(['dog']), new KeywordCondition(['white dog']))
    );
    const condition = queryBuilder.build();
    expect(condition).toMatchSnapshot();
  });
});
