export default function AuthPage({
  authMode,
  setAuthMode,
  authLogin,
  setAuthLogin,
  authPassword,
  setAuthPassword,
  authLoading,
  authError,
  setAuthError,
  handleAuthSubmit
}) {
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleAuthSubmit}>
        <h1>Локалка</h1>
        <p>{authMode === 'login' ? 'Вход в систему' : 'Регистрация пользователя'}</p>

        <input
          value={authLogin}
          onChange={event => setAuthLogin(event.target.value)}
          placeholder="Логин"
          autoComplete="username"
          required
        />
        <input
          value={authPassword}
          onChange={event => setAuthPassword(event.target.value)}
          placeholder="Пароль"
          type="password"
          autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
          required
        />

        {authError ? <div className="status error">{authError}</div> : null}

        <button type="submit" disabled={authLoading}>
          {authLoading ? 'Подождите...' : authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </button>

        <button
          type="button"
          className="ghost"
          onClick={() => {
            setAuthError('');
            setAuthMode(prev => (prev === 'login' ? 'register' : 'login'));
          }}
        >
          {authMode === 'login' ? 'Создать аккаунт' : 'У меня уже есть аккаунт'}
        </button>
      </form>
    </div>
  );
}
