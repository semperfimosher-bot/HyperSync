import {
  useEffect,
  useState,
} from "react";

import {
  cacheUserProfile,
  saveAuthSession,
} from "../../api/auth.js";

import {
  apiRequest,
} from "../../api/client.js";

import HexBackdrop from
  "../HexBackdrop.jsx";

import BrandLogo from
  "../ui/BrandLogo.jsx";

import Icon from
  "../ui/Icon.jsx";


export default function AuthOverlay({
  open,
  mode,
  onModeChange,
  onClose,
  onGuest,
  onAuthenticated,
  onForgotPassword,
}) {
  const [showPassword, setShowPassword] =
    useState(false);

  const [
    createAdmin,
    setCreateAdmin,
  ] = useState(false);

  const [
    showAdminPassword,
    setShowAdminPassword,
  ] = useState(false);

  const [rememberMe, setRememberMe] =
    useState(true);

  const [message, setMessage] =
    useState("");


  useEffect(() => {
    if (
      !open ||
      mode !== "create"
    ) {
      setCreateAdmin(false);
      setShowAdminPassword(false);
    }
  }, [
    open,
    mode,
  ]);


  if (!open) {
    return null;
  }

  const isCreate = mode === "create";

  async function submit(event) {
    event.preventDefault();

    setMessage("");

    const form =
      new FormData(event.currentTarget);

    const username =
      String(
        form.get("username") ?? "",
      ).trim();

    const password =
      String(
        form.get("password") ?? "",
      );

    const adminVerificationPassword =
      String(
        form.get(
          "admin_verification_password",
        ) ?? "",
      );

    if (
      isCreate &&
      createAdmin &&
      !adminVerificationPassword
    ) {
      setMessage(
        "Enter the administrator verification password.",
      );

      return;
    }

    try {
      const data = await apiRequest(
        isCreate
          ? "/auth/register"
          : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(
            isCreate
              ? {
                  username,
                  email: String(
                    form.get("email") ?? "",
                  ).trim(),
                  password,
                  create_admin:
                    createAdmin,
                  admin_verification_password:
                    createAdmin
                      ? adminVerificationPassword
                      : null,
                }
              : {
                  username,
                  password,
                },
          ),
        },
      );

      saveAuthSession(
        data.access_token,
        { remember: rememberMe },
      );

      cacheUserProfile(
        data.user,
        { remember: rememberMe },
      );

      onAuthenticated(data.user);

      onClose();

      setCreateAdmin(false);
      setShowAdminPassword(false);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Authentication failed.",
      );
    }
  }

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <HexBackdrop idPrefix="main-app-background" />

      <div className="auth-panel bevel-panel">
        <button
          className="auth-close"
          type="button"
          onClick={onClose}
          aria-label="Close account screen"
        >
          <Icon
            name="close"
            size={20}
          />
        </button>

        <BrandLogo idPrefix="auth-logo" />

        <div className="auth-heading">
          <h2 id="auth-title">
            {isCreate
              ? "Create your HyperSynced account"
              : "Welcome to HyperSynced"}
          </h2>

          <p>
            {isCreate
              ? (
                "Create a HyperSynced account to save " +
                "your library and sync across devices."
              )
              : (
                "Sync your world. Stream your sound. " +
                "Feel the music."
              )}
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={submit}
        >
          <label>
            <Icon
              name="mail"
              size={22}
            />

            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="Username or email"
              required
            />
          </label>

          {isCreate ? (
            <label>
              <Icon
                name="mail"
                size={22}
              />

              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Email address"
                required
              />
            </label>
          ) : null}

          <label>
            <Icon
              name="lock"
              size={22}
            />

            <input
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              name="password"
              autoComplete={
                isCreate
                  ? "new-password"
                  : "current-password"
              }
              placeholder="Password"
              required
            />

            <button
              type="button"
              onClick={() => {
                setShowPassword(
                  (value) => !value,
                );
              }}
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
            >
              <Icon
                name={
                  showPassword
                    ? "eyeOff"
                    : "eye"
                }
                size={22}
              />
            </button>
          </label>

          {isCreate ? (
            <div className="auth-admin-create">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={createAdmin}
                  onChange={(event) => {
                    const checked =
                      event.target.checked;

                    setCreateAdmin(
                      checked,
                    );

                    if (!checked) {
                      setShowAdminPassword(
                        false,
                      );
                    }

                    setMessage("");
                  }}
                />

                <span>
                  <Icon
                    name="check"
                    size={15}
                  />
                </span>

                Create administrator account
              </label>

              {createAdmin ? (
                <label className="auth-admin-password">
                  <Icon
                    name="shield"
                    size={22}
                  />

                  <input
                    type={
                      showAdminPassword
                        ? "text"
                        : "password"
                    }
                    name="admin_verification_password"
                    autoComplete="off"
                    placeholder="Administrator verification password"
                    required
                  />

                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminPassword(
                        (value) =>
                          !value,
                      );
                    }}
                    aria-label={
                      showAdminPassword
                        ? "Hide administrator password"
                        : "Show administrator password"
                    }
                  >
                    <Icon
                      name={
                        showAdminPassword
                          ? "eyeOff"
                          : "eye"
                      }
                      size={22}
                    />
                  </button>
                </label>
              ) : null}

              <small>
                Administrator accounts require a server-side verification password.
              </small>
            </div>
          ) : null}

          {!isCreate ? (
            <div className="auth-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => {
                    setRememberMe(
                      event.target.checked,
                    );
                  }}
                />

                <span>
                  <Icon
                    name="check"
                    size={15}
                  />
                </span>

                Remember me
              </label>

              <button
                type="button"
                onClick={() => {
                  setMessage("");
                  onForgotPassword?.();
                }}
              >
                Forgot password?
              </button>
            </div>
          ) : null}

          <button
            className="auth-submit"
            type="submit"
          >
            {isCreate
              ? "CREATE ACCOUNT"
              : "SIGN IN"}
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <button
          className="auth-secondary"
          type="button"
          onClick={() => {
            onModeChange(
              isCreate
                ? "signin"
                : "create",
            );
          }}
        >
          {isCreate
            ? "BACK TO SIGN IN"
            : "CREATE ACCOUNT"}
        </button>

        <button
          className="auth-guest"
          type="button"
          onClick={onGuest}
        >
          or use without account
        </button>

        {message ? (
          <p
            className="auth-message"
            role="status"
          >
            {message}
          </p>
        ) : null}

        <p className="auth-legal">
          Terms of Service and Privacy Policy
          pages will be linked before launch.
        </p>
      </div>
    </div>
  );
}
