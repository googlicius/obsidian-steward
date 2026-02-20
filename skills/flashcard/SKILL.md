---
name: flashcard
description: Create and edit flashcards for spaced repetition learning. Use when the user wants to create, modify, format, or troubleshoot flashcards in their notes.
---

# Flashcard Skill

This skill enables you to create and edit flashcards for spaced repetition learning. Flashcards are stored in markdown files with specific formatting rules.

## Flashcard Structure

Flashcards can be defined in two styles:

### Single-Line Style

A single-line flashcard uses `::` or `:::` as separators:

- `Question :: Answer` — Standard flashcard (question on front)
- `Question ::: Answer` — Reversed flashcard (both sides can be swapped)

**Examples:**

```
What is the capital of France? :: Paris


The process of photosynthesis ::: Plants converting light energy into chemical energy
```

### Multiple-Line Style

A multiple-line flashcard uses `?` or `??` as separators:

**Standard flashcard (`?`):**

```
What are the three types of rock?
?
Igneous, sedimentary, and metamorphic
```

**Reversed flashcard (`??`):**

```
The Pythagorean theorem
??
a² + b² = c² in a right triangle
```

## Desk Organization

Flashcards must always belong to a **desk**, indicated by tags prefixed with `#flashcards`:

### Desk Tags

- `#flashcards/Math` — All math flashcards
- `#flashcards/Math/Addition` — Specific topic within math
- `#flashcards/History/WorldWar2` — Multi-level desk hierarchy

**Example:**

```
#flashcards/Math/Addition

What is 2 + 2? :: 4


What is 15 + 27? :: 42


#flashcards/Math/Subtraction

What is 10 - 3? :: 7


What is 50 - 18? :: 32
```

### Rules for Desk Tags

- Every flashcard must be below a desk tag (prefixed with `#flashcards`)
- Desk tags can have hierarchical paths using `/` separator
- All flashcards between one desk tag and the next (or end of file) belong to that desk

## Sequential Review with @start/@end Markers

For flashcards that need to be reviewed in a specific order, use `@start` and `@end` markers:

### Syntax

```
@start <Description>

Question 1 :: Answer 1


Question 2 :: Answer 2


Question 3 :: Answer 3

@end
```

- The `@start` marker **must** include a description
- Flashcards between `@start` and `@end` are always reviewed in sequence
- Sequential groups must still be under a desk tag

**Example:**

```
#flashcards/Spanish/Verbs

@start Present tense conjugation of "hablar"

yo :: hablo


tú :: hablas


él/ella :: habla


nosotros :: hablamos

@end


Regular flashcard outside sequence :: Answer
```

## Formatting Rules

### Critical Rules

1. **Flashcards cannot contain empty lines** — A flashcard ends at the first empty line
2. **Flashcards are separated by 2 empty lines** — This creates clear boundaries between cards
3. **Desk tags required** — All flashcards must be below a `#flashcards/` tag
4. **Sequential groups** — Use `@start <Description>` and `@end` for ordered review

### Valid Flashcard Examples

```
#flashcards/Biology

What is DNA? :: Deoxyribonucleic acid, the molecule that carries genetic information


What is RNA?
?
Ribonucleic acid, involved in protein synthesis and gene regulation


@start Cell organelles and functions

Mitochondria :: Powerhouse of the cell, produces ATP


Nucleus :: Contains genetic material and controls cell activities


Ribosome :: Protein synthesis

@end
```

### Invalid Examples

**❌ Missing desk tag:**

```
What is 2 + 2? :: 4
```

**❌ Empty line within flashcard:**

```
#flashcards/Math

What is the Pythagorean theorem?

:: a² + b² = c²
```

**❌ Only one empty line between flashcards:**

```
#flashcards/History

Question 1 :: Answer 1

Question 2 :: Answer 2
```

**✅ Correct format:**

```
#flashcards/History

Question 1 :: Answer 1


Question 2 :: Answer 2
```

## Creating Flashcards

When creating flashcards for users:

1. **Identify or create appropriate desk tags** based on the subject matter
2. **Choose the right style** — Use single-line for short Q&A, multiple-line for longer content
3. **Use reversed style (`:::` or `??`)** when both directions make sense (e.g., definitions, translations)
4. **Group sequential content** with `@start/@end` when order matters (e.g., conjugations, steps in a process)
5. **Respect spacing** — No empty lines in cards, exactly 2 empty lines between cards

## Example: Complete Flashcard File

```markdown
# Spanish Vocabulary

#flashcards/Spanish/Greetings

Hello :: Hola


Goodbye :: Adiós


Please ::: Por favor


#flashcards/Spanish/Verbs

@start Present tense - estar (to be)

yo :: estoy


tú :: estás


él/ella :: está


nosotros :: estamos

@end


What is the past tense of "ir"?
?
Fui, fuiste, fue, fuimos, fueron


#flashcards/Spanish/Numbers

One to ten in Spanish
?
Uno, dos, tres, cuatro, cinco, seis, siete, ocho, nueve, diez
```

## Rules Summary

- ✅ Always use desk tags prefixed with `#flashcards/`
- ✅ Separate flashcards with exactly 2 empty lines
- ✅ No empty lines within a flashcard
- ✅ Use `::` for standard, `:::` for reversed single-line cards
- ✅ Use `?` for standard, `??` for reversed multiple-line cards
- ✅ Use `@start <Description>` and `@end` for sequential review
- ✅ The `@start` marker must always include a description
