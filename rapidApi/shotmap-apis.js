//sofa-api

const options = {
  method: "GET",
  url: `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/shotmap`,
  headers: {
    "x-rapidapi-key": "a2e0410905msh54d2e36ec6ced44p1e27b3jsnd966f1dce244",
    "x-rapidapi-host": "sportapi7.p.rapidapi.com",
  },
};

try {
  const response = await axios.request(options);
  console.log(response.data);
} catch (error) {
  console.error(error);
}

//sofascore.com

url = "https://www.sofascore.com/api/v1/event/14025184/shotmap";



// SofaSport new 2025-10-31
const options2 = {
  method: "GET",
  url: "https://sofasport.p.rapidapi.com/v1/events/shotmap",
  params: {
    event_id: "10230638",
  },
  headers: {
    "x-rapidapi-key": "d26361d6a1msh55def5349c5e57dp1eaee1jsn74e247833a6e",
    "x-rapidapi-host": "sofasport.p.rapidapi.com",
  },
};

try {
  const response = await axios.request(options);
  console.log(response.data);
} catch (error) {
  console.error(error);
}