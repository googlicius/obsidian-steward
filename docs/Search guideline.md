The `/search` command helps you find notes in your vault.

## Before you start

You need to build the search index first:

```
/ Build search index
```

The index is built and stored locally on your vault.

## Two search modes

### 1. Search without AI

Wrap your query in quotation marks or search tags only:

```
/search "quarterly report"
/search #project #urgent
```

This searches exactly what you type.

### 2. Search with AI

Type `/search` followed by your query in natural language:

```
/search notes about project planning
/search meeting notes from last week
```

The AI breaks your query into keywords, file names, folders, tags, and frontmatter properties to find relevant notes.

## Tips

- Be specific for better results
- Use tags to narrow down results
- Full results are stored in an artifact you can reference later
