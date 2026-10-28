create or replace package body edge_join_alias as
	procedure run is
	begin
		select customer.name
		from   customer
		       join address
		            on address.customer_id = customer.id
		where  customer.active = 1;
	end run;
end edge_join_alias;
/
