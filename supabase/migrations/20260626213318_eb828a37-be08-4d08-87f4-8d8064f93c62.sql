UPDATE public.cases
   SET name = 'routing_benchmark_general_civil',
       description = COALESCE(description || E'\n\n', '') ||
         '[Fixture tier: routing benchmark. One-line placeholder documents. ' ||
         'Use for case-type routing and Release Gate checks only. For ' ||
         'evidence-depth checks, load tests/fixtures/corpora/general_civil/ ' ||
         'via loadCorpus().]'
 WHERE id = '24ace00e-e1bc-4fdb-aaa3-300478c44321'
   AND name = 'general civil';