export type Role = 'user' | 'assistant';

export type ResponseView =
  | {
      type: 'driver_summary';
      title: string;
      season: string;
      driver: {
        name: string;
        team: string;
        position: string;
        points: number | null;
        wins: number | null;
      };
      followups: string[];
    }
  | {
      type: 'constructor_summary';
      title: string;
      season: string;
      constructor: {
        name: string;
        position: string;
        points: number | null;
        wins: number | null;
      };
      followups: string[];
    }
  | {
      type: 'standings_table';
      title: string;
      season: string;
      category: 'drivers' | 'constructors' | 'combined';
      tables: Array<
        | {
            key: 'drivers';
            title: string;
            rows: Array<{
              position: string;
              driverName: string;
              teamName: string;
              points: number | null;
              wins: number | null;
            }>;
          }
        | {
            key: 'constructors';
            title: string;
            rows: Array<{
              position: string;
              constructorName: string;
              points: number | null;
              wins: number | null;
            }>;
          }
      >;
      unavailableTables: Array<'drivers' | 'constructors'>;
    }
  | {
      type: 'next_races_list';
      title: string;
      season: string | null;
      races: Array<{
        round: string;
        raceName: string;
        circuitName: string;
        locality: string;
        country: string;
        date: string;
        userLocalTime: string | null;
        circuitLocalTime: string | null;
        hasSprint: boolean;
      }>;
    }
  | {
      type: 'race_result';
      title: string;
      season: string;
      round: string;
      raceName: string;
      sessionType: 'race' | 'sprint';
      circuit: {
        name: string;
        locality: string;
        country: string;
      };
      results: Array<{
        position: string;
        driverName: string;
        teamName: string;
        points: number | null;
        status: string;
        grid: string | null;
        laps: string | null;
        finishTime: string | null;
      }>;
    }
  | {
      type: 'clarification';
      title: string;
      message: string;
      suggestions: string[];
    }
  | {
      type: 'error';
      title: string;
      message: string;
    };

export interface Message {
  id: string;
  role: Role;
  content: string;
  refinedQuery?: string;
  view?: ResponseView;
}
