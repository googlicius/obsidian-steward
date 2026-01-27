This guideline shows you how to build search index and search with two modes.

> [!NOTE] Search document
> For technical details on tokenization, BM25 scoring, and configuration, see: [Steward search](obsidian://steward-resource?type=doc&name=Steward%20search%20system%20v2)

## Before you start

You need to build the search index first, you can do it directly from here:

/ Build search index

The index is built and stored locally on your vault.

## Two search modes

### 1. Search without AI

Wrap your query in quotation marks or search tags only:

/search "quarterly report"

/search #project #urgent

This searches for either exact matches or relevant results based on what you type.

### 2. Search with AI

Type `/search` followed by your query in natural language:

/search Note names start with "2026"

/search All PDF files in the Media folder

Steward breaks your query into keywords, file names, folders, tags, and frontmatter properties to find relevant notes.

## Tips

- Use tags or wrap your queries in quotation marks for instant results.
- Full results are stored in an artifact you or Steward can reference later.
