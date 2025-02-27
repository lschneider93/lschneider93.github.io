# Logan Schneider
This is a website for projects that I am working on.


### Technical Skills: R, Python, SQL, Tableau, SAS

## Education
- BS in Math/Stats composite | Utah State University (_May 2019_)
- MS in Statistics | Utah State University (_May 2022_)

## Work Experience
**Biostatisician I at Myriad Genetics in Salt Lake City (_July 2022 - Present_)**
- Led discussions and articulated statistical findings to a technical and non-technical audiences
- Conducted statistical modeling utilizing conditional logistic regression, Cox regression for survival analysis, and mixed models.
- Creating Data visualizations to help inform audiences what the data is telling us.

[Recent Publication: Online Screening and Virtual Patient Education for Hereditary Cancer Risk Assessment and Testing](https://pubmed.ncbi.nlm.nih.gov/39637387/)


## Projects
### Thesis: Snow water equalivalent predictions in Utah (_August 2022_)

I created a github package **R** that allows users to access, clean, visualize, and analyze data from Snow Data Assimulation System (SNODAS), University of Arizon (UA), Parameter-elevation Regression on Independe Slopes Model (PRISM), and Snow Telemetry (SNOTEL) stations.

This is important because Utah is a desert and predicting how much water is available is important.  Utah is one area that national products struggle to predict because of it's mountains.  The goal of this project is to make downloading national data, creating your own predictiongs, and combining with other national products to make another prediction.  This will hopefully help others in their own research and improve the predictions throughout Utah and other places.

1. Install rsnodas from GitHub
2. Download SNODAS, PRISM, and SNOTEL data
3. Create Predictions of the amount of water contained in Snow throughout Utah using a Generalized additive model.
4. Combine by weighting National Products (SNODAS) and Generalized additive model based on the distance from Snow Telemetry stations.

This picture shows the overall process of creating predictions using a Generalized additive model and a weights from the Snow Telemetry stations and combining with SNODAS to get the combined
![Overall Process](/Assets/rsnodas_process.png)

This shows how the median and standard deviation of the errors varies from year to year. Overall there was marginal improvement by weighting. The weighting helped when SNODAS was very off in certain years as the GAM model provided some stability. However, SNODAS generally makes a good estimation of the amount of water present in the snow.

![Standard deviation and median of errors of all models](/Assets/Median_SD_Errors.png)

You can read more about my thesis by going to this [website](https://digitalcommons.usu.edu/etd2023/6/) and clicking the download button.

The Github package is free to use and can be seen looking at my profile or clicking this [link](https://github.com/lschneider93/rsnodas)

### LA Crime Data (_March 2022_)

This project was a collaboration with a fellow graduate student, Tom Kerby, from Utah State University. 
The data was from a Kaggle dataset and using Google API, we were able to create figures using google Maps.

In order to Calculate the number of crimes committed in a certain area, we created custom bins and those could vary with size.

Here are the key Graphics from this Project showing the regions where each type of crime (Car stolen, Battery, Petty Theft, and Assault with a weapon) was committed.

![Caption](/Assets/LA_CRIME/Cars_Stolen_Petty_Theft.png)


### Car Crash and Machine Learning methods comparison

This project compares the performance of different methods in predicting the serverity of injuries. There was an column labeled "INJURY" and with the entries being "None" "Minimal" "Minor" 'Major', and "Fatal".  The data came from Kaggle and the data cleaning and processing was minimal but involved investigating each column and seeing the entries and removing entries due to lack of information (removing entries with 'INJURY' being blank). 

I would like to point out that this data was imbalanced and this will provide some difficulty in predicting the severity of the injury.
| None | Minimal | Minor | Major | Fatal |
| ---  |  --- | --- |  --- |   --- |
| 4,268 | 967 | 793 | 4,148 | 593 |
|  ---  |  ---| ---|  ---  | --- |
After cleaning the data the following methods were applied:

1) Random Forest (Regression, Classification, and Binary)
2) Neural Network (Classification)
3) Support Vector Machines
4) K-Nearest Neighbors

What other methods would be interesting to include? 
- Logisitic Regression: This would be a good baseline method to show because the coefficients are interpretable. I want to acknowledge this but also let the reader understand that this project was to display the Machine Learning techniques.  This could be added in the comparison.
- Decision Trees: This provide easy to interpret results and can have great graphics that are very understandable.
- Gradient Boosting: This one will be added as you can tune to account for the class imbalances.  I've worked with these in the past and will train and compare results.
- Other ideas?


### Fraud Detection: Comparison on Model performance

This is being updated. Thank you for your patience!

### Pickleball Analytics (_April 2024 - Current_)

Pickleball has grown in popularity over the last few years. 

After a knee injury in January 2022, I started playing pickleball with a crutch and big knee brace around April 2022 and fell in love with the sport. Honestly, people say that I'm addicted.

Currently, Pickleball doesn't have all the years of development and analysis that other sports have. I've been working on learning computer vision models and that invovles detecting players and location of the ball in relation to the court.
I'm currently working on improving these models and will probably write more in the future.  


