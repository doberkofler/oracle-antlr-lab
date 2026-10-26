create or replace package body edge_conditional as
	procedure run is
	begin
		$if false $then
			dbms_output.put_line('disabled');
		$else
			dbms_output.put_line('enabled');
		$end
	end run;
end edge_conditional;
/
