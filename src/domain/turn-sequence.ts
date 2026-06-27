import { Turn } from "./turn.js";
import { RandomSource } from "./random-source.js";

export class TurnSequence {
  private constructor(readonly turns: ReadonlyArray<Turn>) {}

  get length(): number {
    return this.turns.length;
  }

  get(index: number): Turn {
    return this.turns[index];
  }

  static generate(waypointCount: number, random: RandomSource): TurnSequence {
    if (waypointCount < 2) {
      throw new Error(`waypointCount must be at least 2, got ${waypointCount}`);
    }
    const size = waypointCount - 2;
    const turns: Turn[] = [];
    for (let i = 0; i < size; i++) {
      turns.push(random.nextFloat() < 0.5 ? Turn.Left : Turn.Right);
    }
    return new TurnSequence(turns);
  }
}
