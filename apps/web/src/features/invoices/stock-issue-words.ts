/** What the Cut or Issue confirmation and its toast say (click-through #17). */
export interface StockIssueWords {
  title: string;
  description: string;
  confirmLabel: string;
  /** The success toast. */
  done: string;
}

interface StockIssue {
  /** The reserved quantity, already formatted with formatNumber (CLAUDE.md rule 6). */
  quantity: string;
  /** Its unit label: "ft" for a roll, else the product's stock unit. */
  unit: string;
  /** The roll's number for a cut, or null for boxed goods and other stock. */
  rollNumber: string | null;
  invoiceNumber: string;
}

/**
 * The words that confirm cutting a reserved roll length or issuing reserved stock, and the toast
 * after it (click-through #17). Both move stock and post its cost to the books, and neither can be
 * undone from the invoice, so the dialog names the length and the roll before it happens.
 */
export function stockIssueWords({ quantity, unit, rollNumber, invoiceNumber }: StockIssue): StockIssueWords {
  if (rollNumber) {
    return {
      title: `Cut ${quantity} ${unit} from roll ${rollNumber}?`,
      description: `The length leaves roll ${rollNumber} for ${invoiceNumber} and its cost posts to the books. A cut can't be undone.`,
      confirmLabel: `Cut ${quantity} ${unit}`,
      done: `Cut ${quantity} ${unit} from roll ${rollNumber} for ${invoiceNumber}`,
    };
  }
  return {
    title: `Issue ${quantity} ${unit}?`,
    description: `The stock leaves the warehouse for ${invoiceNumber} and its cost posts to the books. Issuing can't be undone.`,
    confirmLabel: `Issue ${quantity} ${unit}`,
    done: `Issued ${quantity} ${unit} for ${invoiceNumber}`,
  };
}
