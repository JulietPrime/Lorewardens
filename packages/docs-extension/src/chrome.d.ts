declare namespace chrome {
  namespace identity {
    function launchWebAuthFlow(
      options: { url: string; interactive?: boolean },
      callback: (responseUrl?: string) => void,
    ): void;
    function getRedirectURL(path?: string): string;
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const session: StorageArea;
    const local: StorageArea;
  }

  namespace runtime {
    const lastError: { message?: string } | undefined;
    const id: string;
    function getManifest(): { version?: string; name?: string };
    function sendMessage(message: unknown): Promise<unknown>;
    const onInstalled: {
      addListener(listener: () => void): void;
    };
    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => boolean | void,
        ) => boolean | void,
      ): void;
    };
  }

  namespace sidePanel {
    function setOptions(options: { path?: string; enabled?: boolean }): void;
    function setPanelBehavior(options: { openPanelOnActionClick?: boolean }): void;
  }

  namespace alarms {
    function create(name: string, alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): void;
    function clear(name: string): void;
    const onAlarm: {
      addListener(listener: (alarm: { name: string }) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }
    function query(queryInfo: { active?: boolean; currentWindow?: boolean; url?: string | string[] }): Promise<Tab[]>;
  }
}
