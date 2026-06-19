ProjectLens Use-Cases

## UC-01: Research main emission drivers in total emission trends
As a user, I want to be able to discover trends in CO2-emissions and understand the drivers of these trends. 

**How it works**
- base visualization is a line chart that displays the total emissions of a selection of countries 
- by default multiple lines in one chart
- the line charts can be separated in order to distinguish trens for single countries (by dragging one line underneath the line chart)
- a lens can be applied to the discovered trend in one country
- a slope chart appears on the right: bottom year to top year of the lens
- the slope chart displays the emissions mix: land use change, coal, oil, cement, ...
- lenses have multiple stages: stage one (default green), stage two (orange), stage three (light blue)
- stage n can be applied when at least one lens of stage n-1 is currently applied to any country
- the spans of multiple lenses on one country are merged in the slope chart
*example for multiple lenses:*
- lens 1 on Germany spans from 2000 to 2020
- lens 2 on Germany spans from 1950 to 1970
- the slope chart has four parallel values: 1950, 1970, 2000, 2020
- the slope chart contains a line for each emission origin

## UC-02: Reseach common main emission drivers to encounter common trends in multiple countries
- the lens implemented from the prior use case can be used on a chart that contains multiple lines
- the lens behaves just as the other lenses: when applied with shift to multiple graphs, all can move and zoom together, no matter which type of graph they are on
- on the right, a slope graph appears just like it currently does
- the slope graph displays the common (mean) slope for all the countries within the lens scope
- the user can toggle how the mean is calculated: in total or proportional?

## UC-03: Research trends in per-capita emissions with respect to the gdp


## Other Ideas
- add option to exclude land use change (which is often resposible for large differences in emissions)
- moving over the line gives additional info
- grabbing line does not interfere with lens itself