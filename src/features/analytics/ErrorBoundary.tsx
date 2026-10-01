"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { track } from "@/lib/analytics/client";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** What to show instead. A function receives the error and a reset callback. */
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Tag for the analytics event, e.g. "canvas". */
  where?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/** Class boundary (React has no hook for this). Reports every caught error as `error_client`. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const message = String(error?.message ?? error).slice(0, 500);
    const stack = (error?.stack ?? info.componentStack ?? "").slice(0, 2000);
    track("error_client", {
      message,
      ...(stack ? { stack } : {}),
      where: this.props.where ?? "boundary",
    });
    this.props.onError?.(error, info);
  }

  reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback(error, this.reset) : fallback;
  }
}
