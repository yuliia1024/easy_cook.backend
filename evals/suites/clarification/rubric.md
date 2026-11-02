# Clarification question rubric

The reply is the question the meal planning assistant asks instead of planning a menu. The
subject gives:

- `conversation`: the messages so far, oldest first; the reply answers the last user message;
- `known`: the menu request the app already has from the profile and the conversation
  (`days`, `mealTypes`, `caloriesKcal`, `diets`, `excludedIngredients`, `dislikedFoods`;
  null or an empty list is not known);
- `missingFields`: what the app still needs: `days` (how many days the menu covers) and/or
  `mealTypes` (which meals of the day to include);
- `limits`: the fewest and the most days a menu can have;
- `reply`: the question to grade.

The app replies in English whatever language the user writes in; do not fail a criterion for
that.

## asks_for_missing

The reply asks for every item of `missingFields`, in plain words: the number of days for `days`,
the meals of the day for `mealTypes`. When the user asked for more or fewer days than `limits`
allow, offering the nearest allowed number of days for confirmation counts as asking for `days`.
Fail when an item of `missingFields` is not asked for.

## no_repeat

The reply does not ask again for anything the user already gave in the conversation or that
`known` holds, and does not ask for anything outside `missingFields`. Confirming a number of days
the user cannot have and offering another one is not asking again. Fail when a user who already
said, say, "3 days" is asked how many days the menu should cover.

## clear

The user can answer the reply in a single message without guessing what is wanted: plain, polite
words, no technical terms or field names such as `mealTypes`, at most two or three short
sentences. A general opener ("Could you tell me a bit more?") is fine when the reply then names
what exactly it needs; examples or options help but are not required. Fail only when the reply
does not make clear what to answer (a general opener alone), uses technical terms, or is long.

## consistent

Nothing in the reply contradicts the conversation, `known` or `limits`: it does not offer a
number of days outside `limits`, does not state a wrong limit, and does not claim the user said
something they did not. When the user asked for days outside `limits`, the reply says what the
limit is. Fail on any such contradiction.
