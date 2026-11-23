import { EventSourceType, OsEventTypeList } from '@evenrealities/even_hub_sdk';

export interface SimContainerModel {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  borderWidth: number;
  borderColor: number;
  borderRadius: number;
  paddingLength: number;
  textColor: number;
  isEventCapture: number;
  zOrderIndex: number;
  content: string;
}

export interface SdkProtocolLogEntry {
  id: number;
  direction: 'WEB->GLASSES' | 'GLASSES->WEB';
  method: string;
  summary: string;
  timestampMs: number;
}

export interface SimulatorHostState {
  isSimulatedHost: boolean;
  deviceModel: string;
  serialNumber: string;
  batteryLevel: number;
  isConnected: boolean;
  isShutdown: boolean;
  lastExitMode: number | null;
  containers: SimContainerModel[];
  menuItems: Array<{ itemID: number; itemName: string }>;
  protocolLogs: SdkProtocolLogEntry[];
  lastGesture: {
    label: string;
    source: string;
    timestampMs: number;
  } | null;
}

type HostSubscriber = (state: SimulatorHostState) => void;

interface WindowWithEvenGlobals {
  flutter_inappwebview?: {
    callHandler: (handlerName: string, payload: unknown) => Promise<unknown>;
  };
  _listenEvenAppMessage?: (message: unknown) => void;
}

class EvenG2SimulatorHost {
  private storage = new Map<string, string>();
  private subscribers = new Set<HostSubscriber>();
  private logSeq = 1;

  public state: SimulatorHostState = {
    isSimulatedHost: false,
    deviceModel: 'g2',
    serialNumber: 'EVEN-G2-HUD01',
    batteryLevel: 94,
    isConnected: true,
    isShutdown: false,
    lastExitMode: null,
    containers: [],
    menuItems: [],
    protocolLogs: [],
    lastGesture: null,
  };

  public installIfNeeded(): SimulatorHostState {
    if (typeof window === 'undefined') return this.state;
    const win = window as unknown as WindowWithEvenGlobals;

    if (win.flutter_inappwebview?.callHandler && !this.state.isSimulatedHost) {
      // Running inside real Even App WebView on physical phone/glasses
      return this.state;
    }

    this.state.isSimulatedHost = true;
    win.flutter_inappwebview = {
      callHandler: async (_handlerName: string, rawPayload: unknown) => {
        const msg =
          typeof rawPayload === 'string'
            ? (JSON.parse(rawPayload) as Record<string, any>)
            : ((rawPayload ?? {}) as Record<string, any>);
        return this.handleBridgeCall(msg);
      },
    };
    return this.state;
  }

  public subscribe(fn: HostSubscriber): () => void {
    this.subscribers.add(fn);
    fn(this.snapshot());
    return () => {
      this.subscribers.delete(fn);
    };
  }

  public snapshot(): SimulatorHostState {
    return {
      ...this.state,
      containers: this.state.containers.map((c) => ({ ...c })),
      menuItems: this.state.menuItems.map((m) => ({ ...m })),
      protocolLogs: this.state.protocolLogs.slice(0, 18),
      lastGesture: this.state.lastGesture ? { ...this.state.lastGesture } : null,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.subscribers) {
      fn(snap);
    }
  }

  private pushLog(
    direction: 'WEB->GLASSES' | 'GLASSES->WEB',
    method: string,
    summary: string
  ): void {
    this.state.protocolLogs = [
      {
        id: this.logSeq++,
        direction,
        method,
        summary,
        timestampMs: Date.now(),
      },
      ...this.state.protocolLogs,
    ].slice(0, 24);
  }

  private parseContainers(data: Record<string, any>): SimContainerModel[] {
    const texts = Array.isArray(data?.textObject) ? data.textObject : [];
    const parsed: SimContainerModel[] = texts.map(
      (t: Record<string, any>, idx: number) => ({
        containerID: Number(t.containerID ?? idx + 1),
        containerName: String(t.containerName ?? `text-${idx + 1}`),
        xPosition: Number(t.xPosition ?? 0),
        yPosition: Number(t.yPosition ?? 0),
        width: Number(t.width ?? 544),
        height: Number(t.height ?? 40),
        borderWidth: Number(t.borderWidth ?? 0),
        borderColor: Number(t.borderColor ?? 4),
        borderRadius: Number(t.borderRadius ?? 0),
        paddingLength: Number(t.paddingLength ?? 0),
        textColor: Number(t.textColor ?? 4),
        isEventCapture: Number(t.isEventCapture ?? 0),
        zOrderIndex: Number(t.zOrderIndex ?? idx + 1),
        content: String(t.content ?? ''),
      })
    );
    parsed.sort((a, b) => a.zOrderIndex - b.zOrderIndex);
    return parsed;
  }

  private handleBridgeCall(msg: Record<string, any>): unknown {
    const method = String(msg.method ?? '');
    const data = (msg.data ?? {}) as Record<string, any>;

    switch (method) {
      case 'getUserInfo':
        this.pushLog('WEB->GLASSES', method, 'Read Even Hub profile');
        this.emit();
        return {
          uid: 2026,
          name: 'Arena Spectator',
          avatar: '',
          country: 'SG',
        };

      case 'getGlassesInfo':
        this.pushLog(
          'WEB->GLASSES',
          method,
          `Connected: G2 (576x288, ${this.state.batteryLevel}%)`
        );
        this.emit();
        return {
          model: 'g2',
          sn: this.state.serialNumber,
          status: {
            sn: this.state.serialNumber,
            connectType: 'connected',
            isWearing: true,
            batteryLevel: this.state.batteryLevel,
            isCharging: false,
            isInCase: false,
          },
        };

      case 'setLocalStorage':
        this.storage.set(String(data.key ?? ''), String(data.value ?? ''));
        return true;

      case 'getLocalStorage':
        return this.storage.get(String(data.key ?? '')) ?? '';

      case 'createStartUpPageContainer': {
        this.state.isShutdown = false;
        this.state.containers = this.parseContainers(data);
        const menuRaw = data?.menuObject?.menuItems;
        this.state.menuItems = Array.isArray(menuRaw)
          ? menuRaw.map((m: Record<string, any>) => ({
              itemID: Number(m.itemID),
              itemName: String(m.itemName),
            }))
          : [];
        this.pushLog(
          'WEB->GLASSES',
          method,
          `Init ${this.state.containers.length} container(s) on 576x288 HUD`
        );
        this.emit();
        return 0; // StartUpPageCreateResult.success
      }

      case 'rebuildPageContainer': {
        this.state.isShutdown = false;
        this.state.containers = this.parseContainers(data);
        if (data.menuObject?.menuItems) {
          this.state.menuItems = data.menuObject.menuItems.map(
            (m: Record<string, any>) => ({
              itemID: Number(m.itemID),
              itemName: String(m.itemName),
            })
          );
        } else {
          this.state.menuItems = [];
        }
        this.pushLog(
          'WEB->GLASSES',
          method,
          `Rebuilt ${this.state.containers.length} container(s)`
        );
        this.emit();
        return true;
      }

      case 'textContainerUpgrade': {
        const cid = Number(data.containerID);
        const cname = String(data.containerName ?? '');
        for (const c of this.state.containers) {
          if (c.containerID === cid || (cname && c.containerName === cname)) {
            if (typeof data.content === 'string') {
              c.content = data.content;
            }
            if (typeof data.textColor === 'number') {
              c.textColor = data.textColor;
            }
          }
        }
        this.pushLog(
          'WEB->GLASSES',
          method,
          `Updated container #${cid} (${cname})`
        );
        this.emit();
        return true;
      }

      case 'shutDownPageContainer': {
        const exitMode = Number(data.exitMode ?? 0);
        this.state.lastExitMode = exitMode;
        this.state.isShutdown = exitMode === 0;
        this.pushLog(
          'WEB->GLASSES',
          method,
          `shutDownPageContainer(exitMode=${exitMode})`
        );
        this.emit();
        return true;
      }

      default:
        this.pushLog('WEB->GLASSES', method || 'unknown', 'ACK');
        this.emit();
        return true;
    }
  }

  public dispatchHardwareGesture(
    eventType: OsEventTypeList,
    eventSource: EventSourceType = EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
  ): void {
    const labelMap: Record<number, string> = {
      [OsEventTypeList.CLICK_EVENT]: 'SINGLE TAP',
      [OsEventTypeList.DOUBLE_CLICK_EVENT]: 'DOUBLE-TAP',
      [OsEventTypeList.SCROLL_TOP_EVENT]: 'SWIPE FORWARD',
      [OsEventTypeList.SCROLL_BOTTOM_EVENT]: 'SWIPE BACK',
      [OsEventTypeList.LONG_PRESS_EVENT]: 'LONG PRESS',
    };
    const sourceMap: Record<number, string> = {
      [EventSourceType.TOUCH_EVENT_FROM_GLASSES_R]: 'Right Temple',
      [EventSourceType.TOUCH_EVENT_FROM_GLASSES_L]: 'Left Temple',
      [EventSourceType.TOUCH_EVENT_FROM_RING]: 'Even R1 Ring',
    };

    const label = labelMap[eventType] ?? `EVENT_${eventType}`;
    const sourceLabel = sourceMap[eventSource] ?? 'G2 Temple';

    this.state.lastGesture = {
      label,
      source: sourceLabel,
      timestampMs: Date.now(),
    };
    this.pushLog(
      'GLASSES->WEB',
      'evenHubEvent',
      `${label} via ${sourceLabel} (PB=${eventType})`
    );
    this.emit();

    if (typeof window === 'undefined') return;
    const win = window as unknown as WindowWithEvenGlobals;
    if (typeof win._listenEvenAppMessage === 'function') {
      win._listenEvenAppMessage({
        type: 'listen_even_app_data',
        method: 'evenHubEvent',
        data: {
          type: 'sysEvent',
          jsonData: {
            Event_Type: eventType,
            EventSource: eventSource,
          },
        },
      });
    }
  }

  public dispatchMenuAction(itemID: number): void {
    this.pushLog('GLASSES->WEB', 'menuItemClickEvent', `Menu itemID=${itemID}`);
    this.emit();
    if (typeof window === 'undefined') return;
    const win = window as unknown as WindowWithEvenGlobals;
    if (typeof win._listenEvenAppMessage === 'function') {
      win._listenEvenAppMessage({
        type: 'listen_even_app_data',
        method: 'evenHubEvent',
        data: {
          type: 'menuItemClickEvent',
          jsonData: { itemID },
        },
      });
    }
  }
}

export const simulatorHost = new EvenG2SimulatorHost();
