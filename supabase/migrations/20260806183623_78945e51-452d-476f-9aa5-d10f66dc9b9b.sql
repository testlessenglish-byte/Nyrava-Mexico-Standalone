DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, jobname, schedule, command FROM cron.job WHERE command LIKE '%nyravamexico.lovable.app%' LOOP
    PERFORM cron.alter_job(j.jobid, command := replace(j.command, 'https://nyravamexico.lovable.app', 'https://mexico.nyrava.com'));
  END LOOP;
END $$;