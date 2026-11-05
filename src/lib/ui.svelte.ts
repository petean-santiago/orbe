/**
 * Transient UI: context menus, form dialogs and floating panels.
 * Kept apart from repository state so any component can open them.
 */
import type { Plus } from "@lucide/svelte";
import { settings } from "./settings.svelte";

export type Icon = typeof Plus;

export type MenuItem =
  | {
      label: string;
      icon?: Icon;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | { separator: true }
  | { header: string };

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  minWidth?: number;
}

export interface FormField {
  key: string;
  label: string;
  kind?: "text" | "textarea" | "checkbox" | "folder";
  value?: string | boolean;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  /** Return an error message, or null when the value is fine. */
  validate?: (value: string, values: FormValues) => string | null;
}

export type FormValues = Record<string, string | boolean>;

export interface FormRequest {
  title: string;
  description?: string;
  icon?: Icon;
  fields: FormField[];
  confirm: string;
  danger?: boolean;
}

export type SettingsPage = "appearance" | "typography" | "layout" | "arrange" | "ai";

class UiState {
  menu = $state<MenuState | null>(null);
  form = $state<FormRequest | null>(null);
  branchSwitcher = $state(false);
  assistant = $state(false);
  settingsPage = $state<SettingsPage>("appearance");

  /** Window size, kept current by App.svelte; drives the adaptive layout. */
  width = $state(typeof window === "undefined" ? 1360 : window.innerWidth);
  height = $state(typeof window === "undefined" ? 860 : window.innerHeight);

  /** Sidebar shows icons only: chosen in settings, or automatic on narrow windows. */
  get sidebarRail() {
    const mode = settings.value.sidebarMode;
    return mode === "icons" || (mode === "auto" && this.width < 1100);
  }

  /** Below this width the assistant floats over the content instead of taking space. */
  get assistantFloats() {
    return this.width < 1280;
  }

  private resolveForm: ((values: FormValues | null) => void) | null = null;

  /** Open a context menu at the pointer. */
  menuAt(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    this.menu = { x: e.clientX, y: e.clientY, items };
  }

  /** Open a dropdown menu under an element. */
  menuBelow(el: HTMLElement, items: MenuItem[]) {
    const r = el.getBoundingClientRect();
    this.menu = { x: r.left, y: r.bottom + 6, items, minWidth: r.width };
  }

  closeMenu() {
    this.menu = null;
  }

  /** Show a form dialog; resolves with the values, or null when cancelled. */
  ask(request: FormRequest): Promise<FormValues | null> {
    this.resolveForm?.(null);
    this.form = request;
    return new Promise((resolve) => (this.resolveForm = resolve));
  }

  finishForm(values: FormValues | null) {
    const resolve = this.resolveForm;
    this.resolveForm = null;
    this.form = null;
    resolve?.(values);
  }
}

export const ui = new UiState();
