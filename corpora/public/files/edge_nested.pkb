create or replace package body edge_nested as
	procedure run is
	begin
		declare
			l_value number := 1;
		begin
			declare
				l_inner number := 2;
			begin
				l_value := l_value + l_inner;
			end;
		end;
	end run;
end edge_nested;
/
