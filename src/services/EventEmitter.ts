import { logger } from 'src/utils/logger';
import { Events, ErrorEvents, EventPayloadMap } from '../types/events';

type EventCallback = (payload: any) => void;

class EventEmitter {
  private static instance: EventEmitter;
  private listeners: Map<string, Set<EventCallback>>;

  private constructor() {
    this.listeners = new Map();
  }

  public static getInstance(): EventEmitter {
    if (!EventEmitter.instance) {
      EventEmitter.instance = new EventEmitter();
    }
    return EventEmitter.instance;
  }

  public on(event: Events | ErrorEvents, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(callback);
  }

  public off(event: Events | ErrorEvents, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  public emit<T extends keyof EventPayloadMap>(event: T, payload: EventPayloadMap[T]): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(payload);
      } catch (error) {
        logger.error(`Error in event handler for ${event}:`, error);
      }
    });
  }
}

export const eventEmitter = EventEmitter.getInstance();
