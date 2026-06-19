# Purpose of this file
The file _use-cases.md_ describes concrete use cases from which we derive requirements. This file desribes concrete ideas how this project can be leveraged in order to gather insight on the dataset. These descriptions serve as kind of a guideline for the presentation later on. 

## UC-01: Compare emission trends per country

As a user, I wanna be able to compare the trends in emissions between countries and map them to time frames in order to understand during which time period countries underwent changes in emissions. This insight can be used as baseline knowledge for follow-up use-cases. 

**Setup:**\
- list three countries: Germany, China, USA
- merge them into one graph, apply the regression line and hide the base visualization in order to see the change over the whole period of time
- unmerge the countries and apply the regression line via lens. Put the lens at the end in order to see the change in the last few years. There we can see that China rose rapidly while Germany did not. 
- add a second and third lens to fill up the remaining space: display the trends per time in order to understand during which period both countries were different

**Interesting as well**\
- compare Germany and UAE
- around 1970: large rise in per capita emissions, then steady decline
- total amount is steadily rising while per capita is falling? population increase?

**Concern**\
- still has to be evaluated
- does this actually give me insight? 
- maybe evaluate after implementing the other use-cases, just try out some ideas until we get something cool
- should I maybe check GSD for this?