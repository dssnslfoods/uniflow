-- Proofs are retired: sample images are attached to the job's production steps instead.
-- Switch the module and its gate off everywhere, so no design step stays locked waiting for an
-- approval there is no longer a screen for. The proofs table is kept as history.
update app.tenants
set modules = array_remove(modules, 'proof'),
    settings = case when settings #> '{features,proof_gate}' is not null
                    then jsonb_set(settings, '{features,proof_gate}', 'false')
                    else settings end
where 'proof' = any (modules) or coalesce((settings #>> '{features,proof_gate}')::boolean, false);
