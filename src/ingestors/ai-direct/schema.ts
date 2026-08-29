/**
 * JSON Schema for Gemini / OpenAI Structured Outputs matching BankStatement structure.
 */
export const BankStatementJsonSchema = {
  type: 'object',
  properties: {
    institution: {
      type: 'string',
      description: 'The name of the bank or financial institution (e.g. JPMorgan Chase, Bank of America)'
    },
    statementDate: {
      type: 'string',
      description: 'ISO YYYY-MM-DD statement date if present'
    },
    periodStart: {
      type: 'string',
      description: 'ISO YYYY-MM-DD start date of statement period'
    },
    periodEnd: {
      type: 'string',
      description: 'ISO YYYY-MM-DD end date of statement period'
    },
    accounts: {
      type: 'array',
      description: 'List of bank accounts contained within the statement',
      items: {
        type: 'object',
        properties: {
          accountName: {
            type: 'string',
            description: 'Account title or product name, e.g. Chase Total Checking, Adv Plus Banking'
          },
          accountNumberMasked: {
            type: 'string',
            description: 'Masked or full account number, e.g. ...9729'
          },
          accountType: {
            type: 'string',
            enum: ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'MONEY_MARKET', 'LOAN', 'INVESTMENT', 'OTHER']
          },
          currency: {
            type: 'string',
            description: 'Currency code, e.g. USD, CAD, EUR'
          },
          openingBalance: {
            type: 'number',
            description: 'Beginning/opening balance of this account'
          },
          closingBalance: {
            type: 'number',
            description: 'Ending/closing balance of this account'
          },
          totalDeposits: {
            type: 'number',
            description: 'Sum of all deposits and additions'
          },
          totalWithdrawals: {
            type: 'number',
            description: 'Sum of all withdrawals, checks, and subtractions (positive number)'
          },
          transactions: {
            type: 'array',
            description: 'All individual transactions for this account',
            items: {
              type: 'object',
              properties: {
                date: {
                  type: 'string',
                  description: 'ISO YYYY-MM-DD transaction date'
                },
                postDate: {
                  type: 'string',
                  description: 'ISO YYYY-MM-DD posting date if different'
                },
                description: {
                  type: 'string',
                  description: 'Clean merchant or transaction description'
                },
                rawDescription: {
                  type: 'string',
                  description: 'Original raw or multi-line text'
                },
                amount: {
                  type: 'number',
                  description: 'Signed transaction amount: NEGATIVE for expenses/debits/withdrawals/checks, POSITIVE for income/deposits/credits'
                },
                type: {
                  type: 'string',
                  enum: ['DEBIT', 'CREDIT']
                },
                checkNumber: {
                  type: 'string',
                  description: 'Check number if applicable'
                },
                runningBalance: {
                  type: 'number',
                  description: 'Running balance after this transaction if shown on statement'
                },
                category: {
                  type: 'string',
                  description: 'Category if explicitly stated'
                }
              },
              required: ['date', 'description', 'amount', 'type']
            }
          }
        },
        required: ['accountName', 'accountNumberMasked', 'accountType', 'transactions']
      }
    }
  },
  required: ['institution', 'accounts']
};
