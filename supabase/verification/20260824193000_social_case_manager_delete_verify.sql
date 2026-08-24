select
  to_regprocedure('public.delete_social_case_by_assigning_manager(uuid,text)') is not null
    as manager_delete_function_exists,
  exists(
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='social_cases'
      and column_name='deleted_by'
  ) as deleted_by_column_exists,
  exists(
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='social_cases'
      and column_name='deletion_reason'
  ) as deletion_reason_column_exists,
  position(
    'created_by is distinct from v_actor'
    in pg_get_functiondef(
      'public.delete_social_case_by_assigning_manager(uuid,text)'::regprocedure
    )
  ) > 0 as creator_check_exists,
  position(
    'supervising_manager is distinct from v_actor'
    in pg_get_functiondef(
      'public.delete_social_case_by_assigning_manager(uuid,text)'::regprocedure
    )
  ) > 0 as supervising_manager_check_exists;
