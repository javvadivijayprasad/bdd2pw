Feature: Telecom domain rules

  Scenario: Subscriber and plan management
    Then the subscriber is "active"
    And the plan is "Premium"
    And the monthly price is "$50"
    And the phone number is "+1-555-0100"
    And the port-in is "complete"
    And the data usage is "5 GB"
    And the data allowance is "10 GB"
    And the voice usage is "120 min"
    And the SMS count is 42
    And the bill is "$75.50"
    And the service is "active"
    And the signal is "strong"
    And the device IMEI is "123456789012345"
    And the SIM ICCID is "89014103211118510720"
    And the call duration is 30 minutes
    And the roaming is "disabled"
    And the account number is "ACC-987654"
