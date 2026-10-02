-- Admin analytics. Each returns the same JSON shape the old Express API did.

create function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone();
    v_today date := (now() at time zone v_tz)::date;
begin
    perform public.require_admin();
    return jsonb_build_object(
        'today', (select jsonb_build_object('revenue', coalesce(sum(total), 0), 'orders', count(*))
                    from public.orders
                   where status = 'paid' and (created_at at time zone v_tz)::date = v_today),
        'month', (select jsonb_build_object('revenue', coalesce(sum(total), 0), 'orders', count(*))
                    from public.orders
                   where status = 'paid'
                     and (created_at at time zone v_tz)::date >= date_trunc('month', v_today)::date),
        'pendingOrders', (select count(*) from public.orders
                           where status in ('pending', 'confirmed', 'preparing', 'ready')));
end;
$$;

create function public.revenue_series(p_period text default 'week') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone();
    v_margin numeric := coalesce((public.get_setting('profit_margin', '30') #>> '{}')::numeric, 30) / 100;
begin
    perform public.require_admin();
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', day, 'revenue', revenue, 'orders', orders, 'profit', round(revenue * v_margin, 2))
                   order by day), '[]'::jsonb)
          from (select to_char(created_at at time zone v_tz, 'YYYY-MM-DD') as day,
                       sum(total) as revenue, count(*) as orders
                  from public.orders
                 where status = 'paid' and created_at >= public.period_start(p_period)
                 group by 1) d);
end;
$$;

create function public.category_sales(p_period text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    return (
        select coalesce(jsonb_agg(jsonb_build_object('_id', name, 'total', total, 'count', qty)
                   order by total desc), '[]'::jsonb)
          from (select c.name, sum(oi.total) as total, sum(oi.quantity) as qty
                  from public.orders o
                  join public.order_items oi on oi.order_id = o.id
                  join public.menu_items mi on mi.id = oi.menu_item_id
                  join public.categories c on c.id = mi.category_id
                 where o.status = 'paid' and o.created_at >= public.period_start(p_period)
                 group by c.name) s);
end;
$$;

create function public.top_items() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public.require_admin();
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
                   '_id', menu_item_id, 'name', name, 'totalQuantity', qty, 'totalRevenue', revenue)
                   order by qty desc), '[]'::jsonb)
          from (select oi.menu_item_id, min(oi.name) as name, sum(oi.quantity) as qty, sum(oi.total) as revenue
                  from public.orders o
                  join public.order_items oi on oi.order_id = o.id
                 where o.status = 'paid'
                 group by oi.menu_item_id
                 order by qty desc
                 limit 10) t);
end;
$$;

create function public.user_analytics(p_period text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tz text := public.cafe_timezone();
    v_start timestamptz := public.period_start(p_period);
begin
    perform public.require_admin();
    return jsonb_build_object(
        'totalUsers', (select count(*) from public.customers),
        'newUsers', (select count(*) from public.customers where created_at >= v_start),
        'activeUsers', (select count(distinct customer_id) from public.orders
                         where status = 'paid' and created_at >= v_start),
        'returningCustomers', (select count(*) from (
                                  select customer_id from public.orders where status = 'paid'
                                   group by customer_id having count(*) > 1) r),
        'userGrowth', (select coalesce(jsonb_agg(jsonb_build_object('date', to_char(day, 'FMDD Mon'), 'users', n)
                                   order by day), '[]'::jsonb)
                         from (select (created_at at time zone v_tz)::date as day, count(*) as n
                                 from public.customers where created_at >= v_start group by 1) g),
        'topCustomers', (select coalesce(jsonb_agg(jsonb_build_object(
                                   '_id', c.id, 'name', c.name, 'phone', c.phone,
                                   'orderCount', t.order_count, 'totalSpent', t.spent)
                                   order by t.spent desc), '[]'::jsonb)
                           from (select customer_id, count(*) as order_count, sum(total) as spent
                                   from public.orders where status <> 'cancelled' and customer_id is not null
                                  group by customer_id order by spent desc limit 5) t
                           join public.customers c on c.id = t.customer_id));
end;
$$;

create function public.customer_analytics(
    p_search text default '', p_sort_by text default 'totalSpent', p_order text default 'desc',
    p_page integer default 1, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_rows jsonb;
    v_total integer;
    v_search text := '%' || coalesce(trim(p_search), '') || '%';
    v_page integer := greatest(coalesce(p_page, 1), 1);
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
begin
    perform public.require_admin();

    with stats as (
        select c.*,
               count(o.id) as total_orders,
               count(o.id) filter (where o.status = 'paid') as paid_orders,
               coalesce(sum(o.total) filter (where o.status = 'paid'), 0) as total_spent,
               max(o.created_at) as last_order_date
          from public.customers c
          left join public.orders o on o.customer_id = c.id
         where c.name ilike v_search or c.phone ilike v_search or c.email ilike v_search
         group by c.id),
    sorted as (
        select * from stats
         order by
            case when p_order = 'asc' then null else
                case p_sort_by
                    when 'totalOrders' then total_orders::numeric
                    when 'loyaltyPoints' then loyalty_points::numeric
                    when 'lastOrderDate' then extract(epoch from last_order_date)::numeric
                    when 'createdAt' then extract(epoch from created_at)::numeric
                    else total_spent end end desc nulls last,
            case when p_order = 'asc' then
                case p_sort_by
                    when 'totalOrders' then total_orders::numeric
                    when 'loyaltyPoints' then loyalty_points::numeric
                    when 'lastOrderDate' then extract(epoch from last_order_date)::numeric
                    when 'createdAt' then extract(epoch from created_at)::numeric
                    else total_spent end end asc nulls last,
            name
         offset (v_page - 1) * v_limit
         limit v_limit)
    select coalesce(jsonb_agg(jsonb_build_object(
               '_id', id, 'name', name, 'phone', phone, 'email', email,
               'loyaltyPoints', loyalty_points, 'totalPointsEarned', total_points_earned,
               'totalOrders', total_orders, 'paidOrders', paid_orders, 'totalSpent', total_spent,
               'lastOrderDate', last_order_date, 'createdAt', created_at)), '[]'::jsonb)
      into v_rows from sorted;

    select count(*) into v_total from public.customers c
     where c.name ilike v_search or c.phone ilike v_search or c.email ilike v_search;

    return jsonb_build_object('customers', v_rows,
        'pagination', jsonb_build_object('total', v_total, 'page', v_page, 'pages', ceil(v_total::numeric / v_limit)));
end;
$$;

create function public.customer_detail(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_customer public.customers;
    v_tz text := public.cafe_timezone();
begin
    perform public.require_admin();
    select * into v_customer from public.customers where id = p_customer_id;
    if not found then
        raise exception 'Customer not found';
    end if;
    return jsonb_build_object(
        'customer', jsonb_build_object(
            '_id', v_customer.id, 'name', v_customer.name, 'phone', v_customer.phone,
            'email', v_customer.email, 'loyaltyPoints', v_customer.loyalty_points,
            'totalPointsEarned', v_customer.total_points_earned, 'createdAt', v_customer.created_at),
        'stats', (select jsonb_build_object(
                      'totalOrders', count(*),
                      'paidOrders', count(*) filter (where status = 'paid'),
                      'totalSpent', coalesce(sum(total) filter (where status = 'paid'), 0),
                      'avgOrderValue', coalesce(avg(total) filter (where status = 'paid'), 0),
                      'lastOrderDate', max(created_at))
                    from public.orders where customer_id = p_customer_id),
        'favoriteItems', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', qty, 'total', total)
                                   order by qty desc), '[]'::jsonb)
                            from (select oi.name, sum(oi.quantity) as qty, sum(oi.total) as total
                                    from public.orders o join public.order_items oi on oi.order_id = o.id
                                   where o.customer_id = p_customer_id and o.status = 'paid'
                                   group by oi.name order by qty desc limit 5) f),
        'ordersByMonth', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon YYYY'),
                                   'orders', n, 'spent', spent) order by m), '[]'::jsonb)
                            from (select date_trunc('month', created_at at time zone v_tz) as m,
                                         count(*) as n, sum(total) as spent
                                    from public.orders where customer_id = p_customer_id and status = 'paid'
                                   group by 1) mo),
        'recentOrders', (select coalesce(jsonb_agg(public.order_json(o) order by o.created_at desc), '[]'::jsonb)
                           from (select * from public.orders where customer_id = p_customer_id
                                  order by created_at desc limit 10) o));
end;
$$;

create function public.search_orders(
    p_search text default '', p_status text default '', p_start_date timestamptz default null,
    p_end_date timestamptz default null, p_min_amount numeric default null, p_max_amount numeric default null,
    p_page integer default 1, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_page integer := greatest(coalesce(p_page, 1), 1);
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 500);
    v_total integer;
    v_rows jsonb;
    v_search text := '%' || lower(coalesce(trim(p_search), '')) || '%';
begin
    perform public.require_admin();

    with matched as (
        select o.*
          from public.orders o
          left join public.customers c on c.id = o.customer_id
         where (p_status is null or p_status = '' or o.status = p_status)
           and (p_start_date is null or o.created_at >= p_start_date)
           and (p_end_date is null or o.created_at <= p_end_date)
           and (p_min_amount is null or o.total >= p_min_amount)
           and (p_max_amount is null or o.total <= p_max_amount)
           and (coalesce(trim(p_search), '') = ''
                or lower(coalesce(c.name, '')) like v_search
                or coalesce(c.phone, '') like v_search
                or lower(o.order_number) like v_search
                or o.id::text like v_search))
    select (select count(*) from matched),
           (select coalesce(jsonb_agg(public.order_json(p) order by p.created_at desc), '[]'::jsonb)
              from (select * from matched order by created_at desc
                     offset (v_page - 1) * v_limit limit v_limit) p)
      into v_total, v_rows;

    return jsonb_build_object('orders', v_rows,
        'pagination', jsonb_build_object('total', v_total, 'page', v_page, 'pages', ceil(v_total::numeric / v_limit)));
end;
$$;
