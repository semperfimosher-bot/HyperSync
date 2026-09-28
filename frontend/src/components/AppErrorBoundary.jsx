import {
  Component,
} from "react";


export default class AppErrorBoundary
  extends Component {
  constructor(
    props,
  ) {
    super(
      props,
    );

    this.state = {
      error:
        null,
    };
  }


  static getDerivedStateFromError(
    error,
  ) {
    return {
      error,
    };
  }


  componentDidCatch(
    error,
    info,
  ) {
    console.error(
      "HyperSynced UI render failure.",
      error,
      info,
    );
  }


  render() {
    if (
      this.state.error
    ) {
      return (
        <main
          className="app-crash-boundary"
          role="alert"
        >
          <section className="app-crash-boundary__card">
            <span className="app-crash-boundary__eyebrow">
              HYPERSYNCED RECOVERY
            </span>

            <h1>
              A screen failed to render.
            </h1>

            <p>
              Your account, library, downloads, and server data
              were not removed. Reload HyperSynced to rebuild
              the interface from the current saved state.
            </p>

            <button
              type="button"
              onClick={() => {
                globalThis.location
                  ?.reload?.();
              }}
            >
              Reload HyperSynced
            </button>
          </section>
        </main>
      );
    }

    return (
      this.props.children
    );
  }
}
