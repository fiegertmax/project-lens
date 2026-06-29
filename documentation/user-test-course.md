# Feedback from user test in course from 26.05.2026

## Other Students
- (DONE) in the config panel, it would be more intuitive it they were as well expandable by a double click instead of only the plus
- (DONE) there is a bug: when removing countries such that there are < 3 countries left, both countries remain in the legend of the line chart even though they correspond to no line; When removing Germany as the last country, its line remains (might have to do with Germany being the default country?); When removing Germany such that only one other country is left, Germany's line disappears, Germany remains in the legend with its default color, but the remaining country's line switches to Germany's color despite the legend determining another color for that country; When removing countries such that only one country remains, the legend remains in the graph even though 'single country charts' by default need no legend at all.
- (DONE) it would be more intuitive if it were possible to adjust the lens size at the edges with the cursor becoming a <--> symbol
- (LATER; MIGHT be resolved by resolving prof's feedback) the user does not immediately understand that when pressing 'find reasons', the view is switched to total emissions. Making in more obvious or offering an option to undo this would be good.
- (LOW PRIO; does this really matter? Hovering already shows name + description) luc label is cut off in the slope graph

## Professor

### Scatterplot
- (DONE) the scatterplot should switch to the hcl (hue, chroma, luminence) color space
- (DONE) hue can keep determining the country
- (DONE) luminence can determine the time / year
- (DONE) when highlighting a country by hovering, the dots in the scatterplot and the country in the legend must be highlighted

### Lens
- (DONE) having different colors for the lenses makes little sense here
- (DONE) parallel coordinated views: If the lenses are coordinated, the should be FULLY coordinated --> removing the lens with x removes them all; clicking 'find reasons' should keep the other lenses as well, ...

### Slope Chart
- does the slope chart really make sense here? check whether we can show this differently
- if we keep the slope chart: find an alternative for the logarithmic scale: while it ensures each of the driving factors can be looked at in detail, the scale gives a wrong idea on which factor is the actual most important one

### General
- why do we need to switch from per-capita to absolute in order to show the reasons for emissions? The factors can be shown with respect to population as well --> this would remove the earlier confusion of users caused by 'find reasons' switching the view from per-capita to absolute