import {
  Component,
} from "react";

import Icon from "./Icon.jsx";


export default class PageErrorBoundary
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
      "Page render failed",
      error,
      info,
    );
  }


  retry = () => {
    this.setState({
      error:
        null,
    });
  };


  render() {
    if (
      !this.state.error
    ) {
      return this.props.children;
    }

    return (
      <div className="page-stack">
        <section className="admin-page__denied">
          <Icon
            name="chart"
            size={28}
          />

          <h2>
            This page hit an error
          </h2>

          <p>
            The rest of HyperSynced is still running.
            Retry this page, or navigate somewhere else
            and come back.
          </p>

          <button
            type="button"
            className="hs-search-primary-action"
            onClick={
              this.retry
            }
          >
            Retry page
          </button>
        </section>
      </div>
    );
  }
}
