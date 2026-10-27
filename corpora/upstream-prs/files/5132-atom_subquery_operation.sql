-- A parenthesised subquery with a set operation must keep parsing after
-- subquery_operation_part is removed from atom.
SELECT * FROM (SELECT 1 FROM dual UNION ALL SELECT 2 FROM dual) q;

SELECT * FROM ((SELECT 1 FROM dual) UNION ALL (SELECT 2 FROM dual)) q;

SELECT (SELECT 1 FROM dual) + 1 FROM dual;
