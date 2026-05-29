Feature: Banking domain rules

  Scenario: Account balance and transfer
    Then the account balance is "$1,234.56"
    And the account balance is at least "$1,000"
    When I transfer "$500" from "checking" to "savings"
    Then the transaction fee is less than "$5"
    And the statement shows 3 transactions
    And the daily withdrawal limit is "$500"
    And the transaction date is "2026-05-22"
    And the payment status is "completed"
    And the dispute is filed within 60 days
    And the savings withdrawal count is 4
    And the customer has completed KYC verification
    And the transaction is not flagged for AML review
    And the account number ends in "1234"
    And the routing number is "021000021"
    And the available credit is "$5,000"
    And the wire transfer is "completed"
