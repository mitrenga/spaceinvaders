SELECT `ndx`, `name`, `score`, `created`
FROM `rg_si_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
