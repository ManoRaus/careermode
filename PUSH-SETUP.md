# Career Mode — notificações push

O sistema usa Web Push padrão, Supabase Auth anônimo e Supabase Cron. O service worker recebe o push; o servidor verifica alarmes e lembretes mesmo com o site fechado.

## 1. Projeto Supabase

1. Crie um projeto em https://supabase.com/dashboard.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Em Authentication → Providers, habilite **Anonymous Sign-ins**.
4. Copie Project URL e a chave **anon/public** para `supabase-config.js`.

## 2. Chaves VAPID

Instale o Deno e gere as chaves uma única vez:

```bash
deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts
```

O comando imprime um JSON com `publicKey` e `privateKey` (JWK), além da application server key em Base64 URL-safe. Coloque essa application server key em `vapidPublicKey` no arquivo `supabase-config.js`. Guarde o JSON JWK completo como secret `VAPID_KEYS_JWK` no Supabase. Não regenere as chaves depois de cadastrar os dispositivos.

## 3. Publicar a Edge Function

Instale o Supabase CLI, faça login e execute na raiz do projeto:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy dispatch-notifications
supabase secrets set VAPID_SUBJECT=mailto:SEU_EMAIL CRON_SECRET=UM_SEGREDO_LONGO_E_ALEATORIO
```

No Dashboard do Supabase → Edge Functions → Secrets, adicione também `VAPID_KEYS_JWK` com o JSON JWK gerado. O Supabase fornece `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente da Edge Function. Nunca publique a service-role key, o JSON JWK ou a chave privada no GitHub.

## 4. Agendamento a cada minuto

Habilite `pg_cron`, `pg_net` e `supabase_vault` no projeto. No SQL Editor, guarde URL e segredo no Vault e crie o job:

```sql
select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'career_mode_project_url');
select vault.create_secret('UM_SEGREDO_LONGO_E_ALEATORIO', 'career_mode_cron_secret');

select cron.schedule(
  'career-mode-push-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'career_mode_project_url') || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'career_mode_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## 5. Configurar o site

Edite `supabase-config.js` com:
- `url`: Project URL.
- `anonKey`: chave anon/public.
- `vapidPublicKey`: application server key impressa pelo gerador VAPID.

Esses três valores são públicos por natureza. Não coloque a service-role key ou a chave privada VAPID no arquivo.

## 6. Ativar no iPhone

1. Atualize o site e abra pelo ícone do Career Mode na Tela de Início.
2. Na aba Alarmes, toque em **Ativar notificações** e aceite o pedido do iOS.
3. Configure seus alarmes e o lembrete diário de Check-in.
4. Confirme em Ajustes → Notificações → Career Mode que os avisos estão permitidos.

No iOS, a solicitação de permissão precisa ocorrer após um toque explícito no app instalado na Tela de Início. O servidor verifica os horários uma vez por minuto, portanto pode haver até cerca de um minuto de variação, além de atrasos de rede e entrega.

## Observações

- Alarmes e lembrete diário são recorrentes todos os dias.
- A inscrição push é por dispositivo; ative-a em cada aparelho.
- O app mantém tarefas e alarmes localmente; inscrições e horários são sincronizados com o Supabase para envio em segundo plano.
- O lembrete diário começa ativado às 20:00 e pode ser alterado na aba Alarmes.
- Sem configurar o Supabase, o app continua funcionando localmente; o push em segundo plano permanece desativado.
