import type { DateRange } from "../../lib/dateRange";

export type TabProps = {
  clientId: string;
  campaignRowId: string;
  customerId: string;
  campaignId: string;
  currency: string | null;
  range: DateRange;
  agency: boolean;
  isRob: boolean;
  csvBase: string;
};
