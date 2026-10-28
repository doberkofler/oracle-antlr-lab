create or replace package body edge_declare_specs as
	function run(p_value in number) return boolean
	is
	begin
		p_value := p_value + 1;
		begin
			null;
		exception
			when others then
				return false;
		end;
		begin
			null;
		exception
			when others then
				null;
		end;
		return true;
	exception
		when others then return null;
	end run;
end edge_declare_specs;
/
