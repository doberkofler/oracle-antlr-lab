select a.id, b.value
from a, b
where a.id = b.id(+)
and a.value = func(+1)
/
