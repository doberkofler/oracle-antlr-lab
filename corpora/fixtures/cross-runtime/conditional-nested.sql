create or replace procedure conditional_nested is
begin
	$if false $then
		$if true $then
			dbms_output.put_line('inner enabled');
		$end
	$else
		dbms_output.put_line('outer enabled');
	$end
end conditional_nested;
/
