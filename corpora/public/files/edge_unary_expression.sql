select -a + b as signed_operand
     , -(a * (b + c)) as nested_expression
     , +f(x) as function_operand
     , case when a > 0 then -a else +a end as signed_case
     , case (a > 0) when true then -a else +a end as parenthesized_case
from   t
/
select 1
from   dual
where  exists (select 1 from dual)
and    a = any (1, 2)
/
declare
	l_row   t.a%type;
	l_count number;
	c       sys_refcursor;
begin
	l_row := t.a;
	if c%found then
		l_row := -l_row * (l_row + 1);
	end if;
	l_count := sql%rowcount;
	l_count := sql%bulk_rowcount(1);
	l_count := sql%bulk_exceptions(1).error_index;
	l_count := sum(l_count) over (order by l_row);
	null;
end;
/
