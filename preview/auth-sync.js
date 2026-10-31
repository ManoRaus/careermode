/* Career Mode: authentication and synchronized state service.
 * Stage 2 preparation. Not loaded by index.html until UI migration is ready.
 * Requires Supabase JS v2 and the SQL migration in this branch.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'cm_preview_app_data';
  const SYNC_KEY_PREFIX = 'cm_preview_sync_user_';

  function sanitizeState(state) {
    const clean = JSON.parse(JSON.stringify(state || {}));
    if (clean.user) {
      delete clean.user.password;
      delete clean.user.access_token;
      delete clean.user.refresh_token;
    }
    delete clean.password;
    delete clean.access_token;
    delete clean.refresh_token;
    return clean;
  }

  function makeService(client) {
    if (!client || !client.auth || !client.from) {
      throw new Error('Cliente Supabase inválido.');
    }

    async function requireUser() {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || data.user.is_anonymous) {
        throw new Error('Entre com e-mail e senha para sincronizar.');
      }
      return data.user;
    }

    async function register(email, password, metadata = {}) {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: metadata.name || '' } }
      });
      if (error) throw error;
      // Supabase may require email confirmation; session can be null.
      return data;
    }

    async function login(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(), password
      });
      if (error) throw error;
      return data;
    }

    async function resetPassword(email, redirectTo) {
      const { error } = await client.auth.resetPasswordForEmail(
        email.trim(), { redirectTo }
      );
      if (error) throw error;
    }

    async function logout() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }

    async function readState() {
      const user = await requireUser();
      const { data, error } = await client.from('career_user_state')
        .select('payload, revision, updated_at').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return data
        ? { state: sanitizeState(data.payload), revision: data.revision, updatedAt: data.updated_at }
        : { state: null, revision: 0, updatedAt: null };
    }

    async function saveState(state, expectedRevision) {
      await requireUser();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new Error('Revisão inválida.');
      }
      const { data, error } = await client.rpc('save_career_user_state', {
        p_payload: sanitizeState(state),
        p_expected_revision: expectedRevision
      });
      if (error) throw error; // A revision conflict must be resolved, not overwritten.
      return { state: sanitizeState(data.payload), revision: data.revision };
    }

    async function importLocalIfCloudEmpty() {
      const user = await requireUser();
      const cloud = await readState();
      if (cloud.state !== null) return { ...cloud, imported: false };
      const marker = SYNC_KEY_PREFIX + user.id;
      if (localStorage.getItem(marker)) return { ...cloud, imported: false };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...cloud, imported: false };
      const local = sanitizeState(JSON.parse(raw));
      // Do not automatically import local data that may belong to another user.
      return { ...cloud, imported: false, pendingImport: local };
    }

    async function confirmImport(localState) {
      const user = await requireUser();
      const result = await saveState(localState, 0);
      localStorage.setItem(SYNC_KEY_PREFIX + user.id, 'imported');
      // Original local copy is deliberately retained for recovery.
      return result;
    }

    function subscribe(onChange) {
      let channel = null;
      let active = true;
      (async () => {
        const user = await requireUser();
        if (!active) return;
        channel = client.channel('career-state-' + user.id)
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'career_user_state',
            filter: 'user_id=eq.' + user.id
          }, () => onChange())
          .subscribe();
      })().catch(error => onChange(error));
      return () => {
        active = false;
        if (channel) client.removeChannel(channel);
      };
    }

    return {
      register, login, resetPassword, logout, requireUser,
      readState, saveState, importLocalIfCloudEmpty, confirmImport,
      subscribe, sanitizeState
    };
  }

  window.CareerModeAccountService = { makeService, sanitizeState };
})();
