create or replace package body synthetic_2 as
	function routine_0(p_value number) return number is
		l_total number := 0;
	begin
		for i in 1 .. p_value loop
			l_total := l_total + i;
		end loop;
		return case when l_total > 0 then l_total else p_value end;
	end routine_0;

	function routine_1(p_value number) return number is
		l_total number := 0;
	begin
		for i in 1 .. p_value loop
			l_total := l_total + i;
		end loop;
		return case when l_total > 0 then l_total else p_value end;
	end routine_1;

	function routine_2(p_value number) return number is
		l_total number := 0;
	begin
		for i in 1 .. p_value loop
			l_total := l_total + i;
		end loop;
		return case when l_total > 0 then l_total else p_value end;
	end routine_2;

	function routine_3(p_value number) return number is
		l_total number := 0;
	begin
		for i in 1 .. p_value loop
			l_total := l_total + i;
		end loop;
		return case when l_total > 0 then l_total else p_value end;
	end routine_3;

	procedure run is
		l_result number;
		cursor c_values is select level as value from dual connect by level <= 10;
	begin
		for r in c_values loop
			l_result := routine_0(r.value);
		end loop;

		begin
			l_result := l_result + 1;
		exception
			when others then
				l_result := 0;
		end;

		if l_result is not null then
			dbms_output.put_line(to_char(l_result));
		end if;
	end run;
end synthetic_2;
/
