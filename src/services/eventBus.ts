import { EventEmitter } from 'events';

export interface BotEvent {
  type: 'status' | 'log' | 'post' | 'approval' | 'retry';
  data: any;
  timestamp: string;
}

class BotEventBus extends EventEmitter {
  private static instance: BotEventBus;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): BotEventBus {
    if (!BotEventBus.instance) {
      BotEventBus.instance = new BotEventBus();
    }
    return BotEventBus.instance;
  }

  public broadcast(type: BotEvent['type'], data: any): void {
    const event: BotEvent = {
      type,
      data,
      timestamp: new Date().toISOString()
    };
    this.emit('event', event);
  }
}

export const eventBus = BotEventBus.getInstance();
