create or replace procedure conditional_disabled is
begin
	$if false $then
		dbms_output.put_line('disabled');
	$else
		dbms_output.put_line('enabled');
	$end
end conditional_disabled;
/
