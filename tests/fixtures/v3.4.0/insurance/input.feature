Feature: Insurance domain rules

  Scenario: Policy and claim
    Then the policy number is "POL-12345"
    And the premium amount is "$150"
    And the claim status is "approved"
    And the deductible is "$500"
    And the deductible is at most "$1,000"
    And the policy effective date is "2026-01-01"
    And the claim is filed within 90 days
    And the loss reserve is "$10,000"
    And the line of business is "auto"
    And the NAIC code is "12345"
    And the claim is assigned to "Smith"
    And the coverage limit is "$100,000"
    And the policy is "active"
    And the policyholder is "John Doe"
    And the subrogation case is "opened"
    And the premium has been paid
    And the claim payout is "$3,500"
    And the policy renewal date is "2027-01-01"
