create or replace procedure conditional_enabled is
begin
	$if true $then
		dbms_output.put_line('enabled');
	$else
		dbms_output.put_line('disabled');
	$end
end conditional_enabled;
/
