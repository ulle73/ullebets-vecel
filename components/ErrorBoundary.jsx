"use client";

import { Component } from "react";

function DefaultFallback({ error, resetErrorBoundary }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p className="font-semibold">Something went wrong.</p>
      {error?.message ? <p className="mt-1 break-words">{error.message}</p> : null}
      <button
        type="button"
        onClick={resetErrorBoundary}
        className="mt-3 inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.resetErrorBoundary = this.resetErrorBoundary.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught an error", error, info);
    }
  }

  componentDidUpdate(prevProps) {
    const { resetKeys } = this.props;
    if (this.state.hasError && Array.isArray(resetKeys)) {
      const prevKeys = prevProps.resetKeys || [];
      const hasChanged =
        resetKeys.length !== prevKeys.length ||
        resetKeys.some((key, index) => !Object.is(key, prevKeys[index]));
      if (hasChanged) {
        this.resetErrorBoundary();
      }
    }
  }

  resetErrorBoundary() {
    this.setState({ hasError: false, error: null });
    if (typeof this.props.onReset === "function") {
      this.props.onReset();
    }
  }

  render() {
    const { hasError, error } = this.state;
    const { children, FallbackComponent, fallbackRender, fallback } = this.props;

    if (hasError) {
      if (typeof fallbackRender === "function") {
        return fallbackRender({ error, resetErrorBoundary: this.resetErrorBoundary });
      }

      if (FallbackComponent) {
        return <FallbackComponent error={error} resetErrorBoundary={this.resetErrorBoundary} />;
      }

      if (fallback) {
        return typeof fallback === "function"
          ? fallback({ error, resetErrorBoundary: this.resetErrorBoundary })
          : fallback;
      }

      return <DefaultFallback error={error} resetErrorBoundary={this.resetErrorBoundary} />;
    }

    return children;
  }
}
