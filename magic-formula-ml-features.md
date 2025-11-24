# Magic Formula ML Features

Complete documentation of all 76 ML features used for training the betting prediction models.

Total: **76 features** per training sample

## Team Quality Features (6 features)
1. `home_team_opta_rank` - Opta ranking for home team
2. `home_team_opta_rating` - Opta rating for home team
3. `away_team_opta_rank` - Opta ranking for away team
4. `away_team_opta_rating` - Opta rating for away team
5. `opta_rank_diff` - Difference in Opta rank (home - away)
6. `opta_rating_diff` - Difference in Opta rating (home - away)

## Team Profile Base Stats (4 features)
7. `home_{statKey}_avg_{period}` - Home team average for this stat
8. `home_{statKey}_rank_{period}` - Home team rank for this stat
9. `away_{statKey}_avg_{period}` - Away team average for this stat
10. `away_{statKey}_rank_{period}` - Away team rank for this stat

## Overall Rank For/Against (4 features)
11. `home_rank_for` - Home team's offensive rank
12. `home_rank_against` - Home team's defensive rank
13. `away_rank_for` - Away team's offensive rank
14. `away_rank_against` - Away team's defensive rank

## Matchup Score (1 feature)
15. `matchup_score` - home_rank_for / away_rank_against

## WMA Offensive Features (6 features)
16. `home_wma_{statKey}_recent_for` - Home team WMA last 5 matches (own stats)
17. `home_wma_{statKey}_medium_for` - Home team WMA last 15 matches (own stats)
18. `home_wma_{statKey}_long_for` - Home team WMA last 30 matches (own stats)
19. `away_wma_{statKey}_recent_for` - Away team WMA last 5 matches (own stats)
20. `away_wma_{statKey}_medium_for` - Away team WMA last 15 matches (own stats)
21. `away_wma_{statKey}_long_for` - Away team WMA last 30 matches (own stats)

## WMA Defensive Features (6 features)
22. `home_wma_{statKey}_recent_against` - What opponents do vs home (last 5)
23. `home_wma_{statKey}_medium_against` - What opponents do vs home (last 15)
24. `home_wma_{statKey}_long_against` - What opponents do vs home (last 30)
25. `away_wma_{statKey}_recent_against` - What opponents do vs away (last 5)
26. `away_wma_{statKey}_medium_against` - What opponents do vs away (last 15)
27. `away_wma_{statKey}_long_against` - What opponents do vs away (last 30)

## Period Features - 1ST Half (8 features)
28. `home_{statKey}_1ST_for_value` - Home team's own 1st half stats
29. `home_{statKey}_1ST_for_rank` - Home team's rank for 1st half offense
30. `home_{statKey}_1ST_against_value` - What opponents do vs home in 1st half
31. `home_{statKey}_1ST_against_rank` - Home team's defensive rank 1st half
32. `away_{statKey}_1ST_for_value` - Away team's own 1st half stats
33. `away_{statKey}_1ST_for_rank` - Away team's rank for 1st half offense
34. `away_{statKey}_1ST_against_value` - What opponents do vs away in 1st half
35. `away_{statKey}_1ST_against_rank` - Away team's defensive rank 1st half

## Period Features - 2ND Half (8 features)
36. `home_{statKey}_2ND_for_value` - Home team's own 2nd half stats
37. `home_{statKey}_2ND_for_rank` - Home team's rank for 2nd half offense
38. `home_{statKey}_2ND_against_value` - What opponents do vs home in 2nd half
39. `home_{statKey}_2ND_against_rank` - Home team's defensive rank 2nd half
40. `away_{statKey}_2ND_for_value` - Away team's own 2nd half stats
41. `away_{statKey}_2ND_for_rank` - Away team's rank for 2nd half offense
42. `away_{statKey}_2ND_against_value` - What opponents do vs away in 2nd half
43. `away_{statKey}_2ND_against_rank` - Away team's defensive rank 2nd half

## Period Features - ALL (Full Match) (8 features)
44. `home_{statKey}_ALL_for_value` - Home team's full match stats
45. `home_{statKey}_ALL_for_rank` - Home team's rank for full match offense
46. `home_{statKey}_ALL_against_value` - What opponents do vs home full match
47. `home_{statKey}_ALL_against_rank` - Home team's defensive rank full match
48. `away_{statKey}_ALL_for_value` - Away team's full match stats
49. `away_{statKey}_ALL_for_rank` - Away team's rank for full match offense
50. `away_{statKey}_ALL_against_value` - What opponents do vs away full match
51. `away_{statKey}_ALL_against_rank` - Away team's defensive rank full match

## Situational Features - First Goal (3 features)
52. `home_scoreFirst_percentage` - % of matches where home scores first
53. `away_scoreFirst_percentage` - % of matches where away scores first
54. `scoreFirst_percentage_diff` - Difference (home - away)

## Situational Features - Game State (6 features)
55. `home_shotsPerMin_leading` - Home team's shots/min when leading
56. `home_shotsPerMin_trailing` - Home team's shots/min when trailing
57. `home_shotsPerMin_tied` - Home team's shots/min when tied
58. `away_shotsPerMin_leading` - Away team's shots/min when leading
59. `away_shotsPerMin_trailing` - Away team's shots/min when trailing
60. `away_shotsPerMin_tied` - Away team's shots/min when tied

## Situational Features - Tempo (2 features)
61. `home_shotsPer10Min_avg` - Home team's average shots per 10 minutes
62. `away_shotsPer10Min_avg` - Away team's average shots per 10 minutes

## Contextual Features (2 features)
63. `home_advantage` - Binary indicator (always 1 = playing at home)
64. `league_id` - League identifier (numeric)

---

## Feature Summary by Category

| Category | Count | Range |
|----------|-------|-------|
| Team Quality | 6 | 1-6 |
| Team Profile Base | 4 | 7-10 |
| Rank For/Against | 4 | 11-14 |
| Matchup Score | 1 | 15 |
| WMA Offensive | 6 | 16-21 |
| WMA Defensive | 6 | 22-27 |
| Period 1ST | 8 | 28-35 |
| Period 2ND | 8 | 36-43 |
| Period ALL | 8 | 44-51 |
| First Goal | 3 | 52-54 |
| Game State | 6 | 55-60 |
| Tempo | 2 | 61-62 |
| Contextual | 2 | 63-64 |
| **TOTAL** | **76** | |

## Notes

- Features are standardized (not scaled) - XGBoost handles this
- Missing values default to sensible defaults (rank=50, value=0)
- WMA uses exponential decay (0.9^i) for recent matches
- Period features include BOTH offensive (for) and defensive (against)
- All features are calculated at match prediction time (no look-ahead bias)

## Two-Tier ML Architecture

### Tier 1: Raw Features Model
- Uses all 76 features directly
- XGBoost regressor trained on historical matches
- Separate model for each statKey/scope/period combination
- Output: Predicted stat value

### Tier 2: Meta-Learning (Stacking)
- Uses Tier 1 predictions + all formula predictions
- Learns which formulas to trust in different situations
- Includes consensus features (std, range, optimistic/pessimistic)
- Output: Final ensemble prediction
